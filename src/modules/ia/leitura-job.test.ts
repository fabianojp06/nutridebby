import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { exameComLaudo, fotoDeTeste, iaPronta, pacienteInformado, pdfDeTeste } from '../../../test/ia';
import { closeDb, type Tx } from '@/db/client';
import { auditLog, exams, iaTarefas, iaUso, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { excluirExame } from '@/modules/pacientes/exames';
import { atenderPedidoExclusao } from '@/modules/pacientes/lgpd';
import { desativarIa } from './ativacao';
import { cancelarTarefas } from './cancelar';
import { definirRecusaIa } from './ciencia-paciente';
import type { ConfigIA } from './modo';
import { expirarTarefasDoTenant, processarTarefaIA, RepetirIaError, type DepsJobIA } from './leitura-job';
import { custoMaximoDoArquivo, custoMicroUsd } from './precos';
import { ErroProvedor, type ProvedorIA } from './provedor';
import { provedorFake, respostaOk, USO_FAKE } from './provedor-fake';
import { RESPOSTA_SANDBOX } from './provedor-sandbox';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-job-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
// relógio real: as tarefas nascem "agora"; a varredura do teste roda só nos tenants do próprio teste (expirarTarefasDoTenant)
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const IA: ConfigIA = { modo: 'fake', modelo: 'claude-opus-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000_000 };

async function pedido(o: { conteudo?: Buffer; cotaUsd?: number; nome?: string } = {}) {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId, { cotaUsd: o.cotaUsd });
  const p = await pacienteInformado(app.db, T.ctx, o.nome ? { nome: o.nome } : {});
  const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, conteudo: o.conteudo ?? (await pdfDeTeste({ paginas: 2 })) });
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const tarefaId = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, examId, { db: app.db, agora, ia: IA, avisarTeto: async () => 0 });
  return { T, p, examId, tarefaId, d: { tenantId: T.tenantId, tarefaId } };
}
const alertas = () => ({ credencial: vi.fn(async () => 0), teto: vi.fn(async () => 0) });
const deps = (provedor: ProvedorIA | null, extra: Partial<DepsJobIA> = {}): DepsJobIA => ({
  db: app.db, dataDir, modo: 'fake', provedor, geo: 'us', tetoGlobalMicroUsd: IA.tetoGlobalMicroUsd, appUrl: 'https://x', agora: () => agora, ultimaTentativa: false, alertas: alertas(), ...extra,
});
const tarefa = async (P: Awaited<ReturnType<typeof pedido>>) => (await withTenant(P.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, P.tarefaId)), app.db))[0];
const usoDe = async (P: Awaited<ReturnType<typeof pedido>>) => (await withTenant(P.T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, P.tarefaId)), app.db))[0];
const saidas = async (P: Awaited<ReturnType<typeof pedido>>) =>
  withTenant(P.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia'), eq(auditLog.acao, 'exportar'), eq(auditLog.entidadeId, P.tarefaId))), app.db);

describe('job da leitura (US-110 a US-112, RN-100, RN-104, RN-105)', () => {
  it('caminho feliz: PDF sem metadados, reserva reduzida ao teto das páginas, saída marcada e auditada ANTES da chamada, sugestão "pronta" por 7 dias e o custo real', async () => {
    const P = await pedido();
    const f = provedorFake({ ler: [respostaOk(RESPOSTA_SANDBOX)] });
    const teto = custoMaximoDoArquivo('claude-opus-5-5', 'us', { tipo: 'pdf', paginas: 2 });
    const lerOriginal = f.lerDocumento.bind(f);
    f.lerDocumento = async (p) => {
      // no momento da chamada, a saída já está gravada (commit) e a reserva já desceu
      expect((await tarefa(P)).saiuEm).not.toBeNull();
      expect((await usoDe(P)).custoMicroUsd).toBe(teto);
      expect(await saidas(P)).toHaveLength(1);
      return lerOriginal(p);
    };
    expect(await processarTarefaIA(P.d, deps(f))).toBe('pronta');
    expect(f.chamadas.ler).toHaveLength(1);
    expect(f.chamadas.ler[0]).toMatchObject({ modelo: 'claude-opus-5-5', geo: 'us', esforco: 'low', maxTokens: 16_000, arquivo: { tipo: 'pdf', paginas: 2 } });
    const t = await tarefa(P);
    expect(t).toMatchObject({ status: 'pronta', erro: null, tentativas: 1, custoMicroUsd: custoMicroUsd('claude-opus-5-5', 'us', USO_FAKE), reservaMicroUsd: teto });
    expect(t.enviadoEm).not.toBeNull();
    expect(t.expiraEm!.getTime() - agora.getTime()).toBe(7 * 86_400_000);
    expect(t.resultado!.linhas.map((l) => l.valorTexto)).toEqual(RESPOSTA_SANDBOX.marcadores.map((m) => m.valor_texto));
    expect(await usoDe(P)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: t.custoMicroUsd, tokensEntrada: 10_000, inferenceGeo: 'us' });
    expect((await saidas(P))[0]).toMatchObject({ actorUserId: null, patientId: P.p.id });
    expect(await processarTarefaIA(P.d, deps(f))).toBe('ignorada'); // idempotente: não reenvia
    expect(f.chamadas.ler).toHaveLength(1);
  });

  it('foto vai como imagem JPEG', async () => {
    const P = await pedido({ conteudo: await fotoDeTeste({ largura: 800, altura: 600 }) });
    const f = provedorFake();
    await processarTarefaIA(P.d, deps(f));
    expect(f.chamadas.ler[0].arquivo.tipo).toBe('imagem');
  });

  it.each([
    ['laudo de 16 páginas', async () => pdfDeTeste({ paginas: 16 }), 'laudo_longo'],
    ['PDF corrompido', async () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 0x41)]), 'arquivo_invalido'],
  ])('%s → %s, nada sai ao provedor (sem marca de saída nem auditoria) e a reserva é estornada', async (_n, conteudo, motivo) => {
    const P = await pedido({ conteudo: await conteudo() });
    const f = provedorFake();
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect(await tarefa(P)).toMatchObject({ status: 'falhou', erro: motivo, enviadoEm: null, saiuEm: null });
    expect(f.chamadas.ler).toHaveLength(0);
    expect(await saidas(P)).toHaveLength(0);
    expect((await usoDe(P)).situacao).toBe('estornado');
  });

  it('RN-100 no worker: paciente bloqueado, recusa, ciência retirada ou IA desativada depois do pedido → falha sem envio', async () => {
    const casos: [string, (P: Awaited<ReturnType<typeof pedido>>) => Promise<unknown>, string][] = [
      ['bloqueado', (P) => withTenant(P.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora }).where(eq(patients.id, P.p.id)), app.db), 'paciente_indisponivel'],
      ['recusa', (P) => withTenant(P.T.ctx, (tx) => tx.update(patients).set({ iaRecusadaEm: agora }).where(eq(patients.id, P.p.id)), app.db), 'paciente_indisponivel'],
      ['sem ciência', (P) => withTenant(P.T.ctx, (tx) => tx.update(patients).set({ iaAvisoVersao: null, iaAvisoEm: null, iaAvisoCanal: null }).where(eq(patients.id, P.p.id)), app.db), 'paciente_nao_informado'],
      ['IA desativada', (P) => app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, P.T.tenantId)), 'ia_desligada'],
      ['tenant suspenso', (P) => app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, P.T.tenantId)), 'ia_desligada'],
    ];
    for (const [nome, mudar, motivo] of casos) {
      const P = await pedido();
      await mudar(P);
      const f = provedorFake();
      expect(await processarTarefaIA(P.d, deps(f)), nome).toBe('falhou');
      expect(await tarefa(P), nome).toMatchObject({ status: 'falhou', erro: motivo, saiuEm: null });
      expect(f.chamadas.ler, nome).toHaveLength(0);
      expect((await usoDe(P)).situacao, nome).toBe('estornado');
    }
  });

  it('portão do envio (Review Focus 4): recusa, exclusão atendida, IA desativada ou exame excluído DEPOIS da leitura da tarefa e antes do envio → nada sai, nem uma chamada', async () => {
    const casos: [string, (P: Awaited<ReturnType<typeof pedido>>) => Promise<unknown>, string][] = [
      ['Não usar IA', (P) => definirRecusaIa(P.T.ctx, P.p.id, true, { db: app.db, agora }), 'paciente_indisponivel'],
      ['exclusão atendida', (P) => atenderPedidoExclusao(P.T.ctx, P.T.tenant, P.p.id, 'Ana Souza', { db: app.db, now: agora }), 'paciente_indisponivel'],
      ['IA desativada', (P) => desativarIa(P.T.ctx, { db: app.db, agora }), 'ia_desligada'],
      ['exame excluído', (P) => excluirExame(P.T.ctx, P.p.id, P.examId, { db: app.db, dataDir }), 'exame_indisponivel'],
    ];
    for (const [nome, mudar, motivo] of casos) {
      const P = await pedido({ nome: 'Ana Souza' });
      const f = provedorFake();
      // a mudança entra depois do passo (1) (tarefa lida, paciente e exame conferidos, arquivo preparado) e antes do portão
      expect(await processarTarefaIA(P.d, deps(f, { depoisDoPreparo: () => mudar(P) })), nome).toBe('falhou');
      expect(await tarefa(P), nome).toMatchObject({ status: 'falhou', erro: motivo, enviadoEm: null, saiuEm: null });
      expect(f.chamadas.ler, nome).toHaveLength(0);
      expect(await saidas(P), nome).toHaveLength(0);
      expect((await usoDe(P)).situacao, nome).toBe('estornado');
    }
  });

  it('duas execuções do mesmo job ao mesmo tempo (expiração do pg-boss): o laudo sai uma vez só', async () => {
    const P = await pedido();
    const f = provedorFake({ atrasoMs: 200 });
    await Promise.all([processarTarefaIA(P.d, deps(f)), processarTarefaIA(P.d, deps(f))]);
    expect(f.chamadas.ler).toHaveLength(1);
    expect(await saidas(P)).toHaveLength(1);
  });

  it('exame excluído ou arquivo sumido do disco → exame_indisponivel, sem envio', async () => {
    const P = await pedido();
    const [e] = await withTenant(P.T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, P.examId)), app.db);
    unlinkSync(path.join(dataDir, e.arquivoPath!));
    expect(await processarTarefaIA(P.d, deps(provedorFake()))).toBe('falhou');
    expect((await tarefa(P)).erro).toBe('exame_indisponivel');
  });

  it('sem chave no worker (modo anthropic, provedor nulo) → credencial_invalida + alerta aos admins', async () => {
    const P = await pedido();
    const a = alertas();
    expect(await processarTarefaIA(P.d, deps(null, { modo: 'anthropic', alertas: a }))).toBe('falhou');
    expect((await tarefa(P)).erro).toBe('credencial_invalida');
    expect(a.credencial).toHaveBeenCalledTimes(1);
  });

  it('RN-105: 529 → relança (nova tentativa) com enviado_em limpo e saiu_em mantido; na última tentativa → provedor_indisponivel e estorno', async () => {
    const P = await pedido();
    const f = provedorFake({ ler: [new ErroProvedor('repetir', 529, 'r1'), new ErroProvedor('repetir', 529, 'r2')] });
    await expect(processarTarefaIA(P.d, deps(f))).rejects.toBeInstanceOf(RepetirIaError);
    const t1 = await tarefa(P);
    expect(t1).toMatchObject({ status: 'processando', enviadoEm: null });
    expect(t1.saiuEm).not.toBeNull(); // o laudo chegou ao provedor (529): o registro de saída fica
    expect(await processarTarefaIA(P.d, deps(f, { ultimaTentativa: true }))).toBe('falhou');
    const t2 = await tarefa(P);
    expect(t2).toMatchObject({ erro: 'provedor_indisponivel', tentativas: 2 });
    expect(t2.saiuEm).toEqual(t1.saiuEm); // a primeira saída
    expect(await saidas(P)).toHaveLength(2); // uma linha de auditoria por saída
    expect((await usoDe(P)).situacao).toBe('estornado');
  });

  it('RN-105: tempo esgotado depois do envio → resultado_incerto (reserva mantida); a nova tentativa NÃO reenvia', async () => {
    const P = await pedido();
    const f = provedorFake({ ler: [new ErroProvedor('incerto', 504, 'r')] });
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect((await tarefa(P)).erro).toBe('resultado_incerto');
    expect((await usoDe(P)).situacao).toBe('incerto');
    expect(await processarTarefaIA(P.d, deps(f))).toBe('ignorada');
    expect(f.chamadas.ler).toHaveLength(1);
  });

  it('o worker caiu depois de marcar o envio (processando com enviado_em) → incerto sem reenviar', async () => {
    const P = await pedido();
    await withTenant(P.T.ctx, (tx) => tx.update(iaTarefas).set({ status: 'processando', enviadoEm: agora, saiuEm: agora }).where(eq(iaTarefas.id, P.tarefaId)), app.db);
    const f = provedorFake();
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect((await tarefa(P)).erro).toBe('resultado_incerto');
    expect(f.chamadas.ler).toHaveLength(0);
  });

  it.each([
    [new ErroProvedor('credencial', 401, null), 'credencial_invalida', 'estornado'],
    [new ErroProvedor('limite_de_gasto', 429, null), 'teto_plataforma', 'estornado'],
    [new ErroProvedor('grande_demais', 413, null), 'arquivo_invalido', 'estornado'],
    [new ErroProvedor('pedido_invalido', 400, null), 'resposta_invalida', 'estornado'],
    [new Error('bug qualquer depois do envio'), 'resultado_incerto', 'incerto'],
  ])('erro %o → %s (%s), sem nova tentativa; a saída fica registrada', async (erro, motivo, situacao) => {
    const P = await pedido();
    const a = alertas();
    expect(await processarTarefaIA(P.d, deps(provedorFake({ ler: [erro] }), { alertas: a }))).toBe('falhou');
    const t = await tarefa(P);
    expect(t.erro).toBe(motivo);
    expect(t.saiuEm).not.toBeNull();
    expect((await usoDe(P)).situacao).toBe(situacao);
    if (motivo === 'credencial_invalida') expect(a.credencial).toHaveBeenCalled();
    if (motivo === 'teto_plataforma') expect(a.teto).toHaveBeenCalled();
  });

  it('recusa (categoria bio), saída cortada, não é laudo, nada encontrado, JSON fora do formato', async () => {
    const casos: [Parameters<typeof provedorFake>[0], string][] = [
      [{ ler: [{ tipo: 'recusa', categoria: 'bio', uso: USO_FAKE, requestId: 'r' }] }, 'recusa'],
      [{ ler: [{ tipo: 'cortada', uso: USO_FAKE, requestId: 'r' }] }, 'resposta_invalida'],
      [{ ler: [respostaOk({ documento_reconhecido: false, data_coleta: null, marcadores: [] })] }, 'documento_nao_reconhecido'],
      [{ ler: [respostaOk({ documento_reconhecido: true, data_coleta: null, marcadores: [] })] }, 'nada_encontrado'],
      [{ ler: [respostaOk('{"isto": "não é o formato"}')] }, 'resposta_invalida'],
    ];
    for (const [roteiro, motivo] of casos) {
      const P = await pedido();
      expect(await processarTarefaIA(P.d, deps(provedorFake(roteiro))), motivo).toBe('falhou');
      expect(await tarefa(P), motivo).toMatchObject({ erro: motivo, resultado: null });
      const u = await usoDe(P);
      expect(u.situacao, motivo).toBe('confirmado'); // houve resposta: custo real
      if (motivo === 'recusa') expect(u.recusaCategoria).toBe('bio');
    }
  });

  it.each([
    ['o paciente foi bloqueado', (P: Awaited<ReturnType<typeof pedido>>) => withTenant(P.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora }).where(eq(patients.id, P.p.id)), app.db), 'paciente_indisponivel'],
    ['a IA foi desativada', (P: Awaited<ReturnType<typeof pedido>>) => desativarIa(P.T.ctx, { db: app.db, agora }), 'ia_desligada'],
    ['a admin bloqueou a IA', (P: Awaited<ReturnType<typeof pedido>>) => app.db.update(tenants).set({ iaLiberada: false }).where(eq(tenants.id, P.T.tenantId)), 'ia_desligada'],
    ['o exame foi excluído', (P: Awaited<ReturnType<typeof pedido>>) => excluirExame(P.T.ctx, P.p.id, P.examId, { db: app.db, dataDir }), 'exame_indisponivel'],
  ])('%s DURANTE a chamada: a resposta não é gravada (%s), o custo é', async (_n, mudar, motivo) => {
    const P = await pedido();
    const f = provedorFake();
    const lerOriginal = f.lerDocumento.bind(f);
    f.lerDocumento = async (p) => {
      await mudar(P);
      return lerOriginal(p);
    };
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect(await tarefa(P)).toMatchObject({ erro: motivo, resultado: null });
    expect((await usoDe(P)).situacao).toBe('confirmado');
  });

  // Revisão da T11 (Important 1): a mudança faz o trabalho dela (inclusive o cancelarTarefas, que ainda vê "processando" e
  // pula a linha) e fica SEM commit enquanto o passo (6) grava. Sem as travas no passo (6), ele leria a versão confirmada
  // (sem a mudança) e gravaria a "pronta" com o resultado. Com elas (paciente → exame → tenant FOR SHARE, antes da tarefa),
  // o passo (6) espera o commit e vê a mudança.
  it.each([
    [
      '"Não usar IA"',
      async (tx: Tx, P: Awaited<ReturnType<typeof pedido>>) => {
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, P.p.id)).for('update');
        await tx.update(patients).set({ iaRecusadaEm: agora }).where(eq(patients.id, P.p.id));
        await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, P.T.tenantId)).for('update');
        await cancelarTarefas(tx, { patientId: P.p.id, agora });
      },
      'paciente_indisponivel',
    ],
    [
      'a desativação da IA',
      async (tx: Tx, P: Awaited<ReturnType<typeof pedido>>) => {
        await tx.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, P.T.tenantId));
        await cancelarTarefas(tx, { agora });
      },
      'ia_desligada',
    ],
    [
      'a exclusão do exame',
      async (tx: Tx, P: Awaited<ReturnType<typeof pedido>>) => {
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, P.p.id)).for('update');
        await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, P.T.tenantId)).for('update');
        await cancelarTarefas(tx, { patientId: P.p.id, examId: P.examId, agora });
      },
      'exame_indisponivel',
      // o DELETE (e o SET NULL na tarefa) vem depois: o passo (6) pegaria a tarefa antes e gravaria a "pronta", órfã
      async (tx: Tx, P: Awaited<ReturnType<typeof pedido>>) => tx.delete(exams).where(eq(exams.id, P.examId)),
    ],
  ])('%s sem commit enquanto o passo (6) grava: ele espera a mudança e não deixa "pronta" com o resultado', async (_n, mudar, motivo, depois?) => {
    const P = await pedido();
    const f = provedorFake();
    const lerOriginal = f.lerDocumento.bind(f);
    let soltar!: () => void;
    const portaoDaMudanca = new Promise<void>((r) => (soltar = r));
    let mudanca: Promise<unknown> = Promise.resolve();
    f.lerDocumento = async (p) => {
      let feito!: () => void;
      const mudou = new Promise<void>((r) => (feito = r));
      mudanca = withTenant(
        P.T.ctx,
        async (tx) => {
          await mudar(tx, P);
          feito();
          await portaoDaMudanca; // fica aberta (travas mantidas, sem commit) enquanto o passo (6) corre
          await depois?.(tx, P);
        },
        app.db,
      );
      await mudou;
      setTimeout(soltar, 300); // o commit chega depois de o passo (6) começar
      return lerOriginal(p);
    };
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    await mudanca;
    expect(await tarefa(P)).toMatchObject({ status: 'falhou', erro: motivo, resultado: null });
    expect((await usoDe(P)).situacao).toBe('confirmado');
  });

  it('varredura (só nos tenants deste teste): processando > 15 min → interrompida (estorno se não enviado; incerto se enviado); na fila > 30 min → interrompida; pronta vencida → expirada e esvaziada', async () => {
    const A = await pedido();
    const B = await pedido();
    const C = await pedido();
    const D = await pedido();
    await withTenant(A.T.ctx, (tx) => tx.update(iaTarefas).set({ status: 'processando', iniciadoEm: new Date(agora.getTime() - 16 * 60_000) }).where(eq(iaTarefas.id, A.tarefaId)), app.db);
    await withTenant(B.T.ctx, (tx) => tx.update(iaTarefas).set({ status: 'processando', iniciadoEm: new Date(agora.getTime() - 16 * 60_000), enviadoEm: new Date(agora.getTime() - 15 * 60_000) }).where(eq(iaTarefas.id, B.tarefaId)), app.db);
    await withTenant(C.T.ctx, (tx) => tx.update(iaTarefas).set({ criadoEm: new Date(agora.getTime() - 31 * 60_000) }).where(eq(iaTarefas.id, C.tarefaId)), app.db);
    await processarTarefaIA(D.d, deps(provedorFake()));
    await withTenant(D.T.ctx, (tx) => tx.update(iaTarefas).set({ expiraEm: new Date(agora.getTime() - 1) }).where(eq(iaTarefas.id, D.tarefaId)), app.db);
    // a varredura global (expirarTarefasIA) percorre todos os tenants do banco de teste, que é compartilhado pelos arquivos
    // que rodam em paralelo: o teste chama só a parte por tenant, para não expirar tarefas de outros arquivos
    let r = { interrompidas: 0, expiradas: 0 };
    for (const X of [A, B, C, D]) {
      const x = await withTenant({ tenantId: X.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, agora), app.db);
      r = { interrompidas: r.interrompidas + x.interrompidas, expiradas: r.expiradas + x.expiradas };
    }
    expect(r).toEqual({ interrompidas: 3, expiradas: 1 });
    expect(await tarefa(A)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
    expect((await usoDe(A)).situacao).toBe('estornado');
    expect((await usoDe(B)).situacao).toBe('incerto');
    expect(await tarefa(C)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
    expect(await tarefa(D)).toMatchObject({ status: 'expirada', resultado: null });
  });
});
