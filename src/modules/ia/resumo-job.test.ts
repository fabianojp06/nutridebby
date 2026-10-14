import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, prontuarioCompleto } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, consultations, iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { processarJobAssistente } from './assistente-job';
import { registrarRetiradaPelaNutri } from './autorizacao';
import { CATEGORIAS_POR_USO } from './campos-enviados';
import { expirarTarefasDoTenant, RepetirIaError } from './leitura-job';
import type { DepsJobAssistente } from './modelos-job';
import type { ProvedorIA } from './provedor';
import { ErroProvedor, finalOk, provedorFake } from './provedor-fake';
import { provedorSandbox } from './provedor-sandbox';
import { abrirResumo, pedirResumo } from './resumo';
import { processarResumo } from './resumo-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const deps = { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 };
const jobDeps = (provedor: ProvedorIA | null, extra: Partial<DepsJobAssistente> = {}): DepsJobAssistente => ({
  db: app.db,
  modo: 'fake',
  provedor,
  geo: 'us',
  destino: 'teste',
  retencao: 'zero',
  tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd,
  appUrl: 'https://x',
  agora: () => agora,
  ultimaTentativa: false,
  alertas: { credencial: async () => 0, teto: async () => 0 },
  modeloAssistente: IA_TESTE.modeloAssistente,
  tetoRascunhoMicroUsd: IA_TESTE.tetoRascunhoMicroUsd,
  ...extra,
});

async function cenario() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  await autorizacaoNoBanco(app.db, T.tenantId, p.id);
  await prontuarioCompleto(app.db, T.ctx, p.id);
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, p, tenant: tenant as TenantRow };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;
const tarefa = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0];
const uso = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0];
const pedir = (C: Cenario, notasPrivadas = false) => pedirResumo(C.T.ctx, C.tenant, C.p.id, { notasPrivadas, gerarDeNovo: false }, deps);
const enviado = (f: ReturnType<typeof provedorFake>, i = 0) => {
  const t = f.chamadas.gerar[i].turnos[0] as unknown as { blocos: { texto: string }[] };
  return JSON.parse(t.blocos[0].texto.split('\n').at(-1)!) as Record<string, unknown>;
};
const saidas = async (C: Cenario, tarefaId: string) =>
  withTenant(C.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, tarefaId), eq(auditLog.acao, 'exportar'))), app.db);

describe('processarResumo (US-120, §5.6, RN-108, CS-105)', () => {
  it('portão: "Dados enviados à IA" (exportar), destino e saiu_em; manda só as categorias do resumo; grava a pronta com fontes e tabela', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const f = provedorFake({ gerar: [finalOk({ secoes: [{ secao: 'evolucao', frases: [{ texto: 'O peso caiu.', fontes: ['#1'] }, { texto: 'Sem fonte.', fontes: [] }] }] })] });
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('pronta');
    const dados = enviado(f);
    for (const k of Object.keys(dados)) expect(CATEGORIAS_POR_USO.resumo_historico).toContain(k);
    expect(dados).not.toHaveProperty('notas'); // "Incluir notas privadas" desmarcada
    expect(f.chamadas.gerar).toHaveLength(1);
    expect(f.chamadas.gerar[0]).toMatchObject({ finalidade: 'resumo', modelo: 'claude-sonnet-5-5', ferramentas: [], esforco: 'low' });
    const t = await tarefa(C, tarefaId);
    expect(t).toMatchObject({ status: 'pronta', destino: 'teste', parametros: { notasPrivadas: false } });
    expect(t.saiuEm).not.toBeNull();
    expect(t.expiraEm!.getTime()).toBe(agora.getTime() + 7 * 86_400_000);
    expect(t.resultado).toMatchObject({ tipo: 'resumo', versao: 1, retiradas: 1, secoes: [{ secao: 'evolucao', frases: [{ texto: 'O peso caiu.', fontes: ['#1'] }] }] });
    const r = t.resultado as { fontes: { indice: string; rotulo: string }[]; tabela: { rotulo: string }[] };
    expect(r.fontes[0]).toEqual({ indice: '#1', rotulo: 'antropometria de 01/04/2026' });
    expect(r.tabela.map((l) => l.rotulo)).toContain('Peso');
    const u = await uso(C, tarefaId);
    expect(u).toMatchObject({ situacao: 'confirmado', requestId: 'fake-req' });
    expect(u.custoMicroUsd).toBe(t.custoMicroUsd);
    const h = await listAccessHistory(C.T.ctx, C.p.id, 1, app.db);
    expect(h.itens.map(rotuloDaAcao)).toEqual(expect.arrayContaining(['Pediu resumo à IA', 'Dados enviados à IA']));
    expect(h.itens.find((i) => i.entidade === 'ia' && i.acao === 'exportar')?.ator).toBeNull(); // o worker ("Sistema")
  });

  it('com "Incluir notas privadas": as notas saem, mascaradas', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C, true);
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('pronta');
    const dados = enviado(f);
    expect(dados).toHaveProperty('notas');
    expect(JSON.stringify(dados)).not.toContain(C.p.nome);
  });

  it('o roteador da fila ia-assistente leva a tarefa de resumo a processarResumo', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    expect(await processarJobAssistente({ tenantId: C.T.tenantId, tarefaId }, jobDeps(provedorSandbox()))).toBe('pronta');
    expect((await tarefa(C, tarefaId)).status).toBe('pronta');
  });

  it('CS-105: retirada entre o pedido e o portão → nada sai (sem_autorizacao), estorno', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    await registrarRetiradaPelaNutri(C.T.ctx, C.p.id, { db: app.db });
    const f = provedorFake();
    // a retirada da nutricionista já cancela a da fila; a do paciente (job ia-retirada atrasado) é o caso do portão:
    expect(['ignorada', 'falhou']).toContain(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f)));
    expect(f.chamadas.gerar).toHaveLength(0);
    expect((await uso(C, tarefaId)).situacao).toBe('estornado');
  });

  it('CS-105 pelo portão: autorização do paciente retirada (app, sem o job) → falhou sem_autorizacao, sem chamada, estorno', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await tarefa(C, tarefaId)).toMatchObject({ status: 'falhou', erro: 'sem_autorizacao', saiuEm: null, parametros: null });
    expect((await uso(C, tarefaId)).situacao).toBe('estornado');
    expect(await saidas(C, tarefaId)).toHaveLength(0);
  });

  it('RN-108 (D14): retirada e reautorização depois do pedido → a tarefa de antes da retirada não sai', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id);
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect((await tarefa(C, tarefaId)).erro).toBe('sem_autorizacao');
  });

  it('sem a retenção aceita no worker → ia_desligada, sem chamada, estorno', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f, { retencao: null }))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await tarefa(C, tarefaId)).toMatchObject({ erro: 'ia_desligada', saiuEm: null });
    expect((await uso(C, tarefaId)).situacao).toBe('estornado');
  });

  it('D12: o pedido cresceu além da reserva entre o app e o portão → limite_custo sem enviar', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    // a reserva é ≈ 1,5 × o pedido montado; inflar o pedido com 10 atendimentos de 2.000 caracteres passa dela
    await withTenant(C.T.ctx, (tx) => tx.insert(consultations).values({ tenantId: C.T.tenantId, patientId: C.p.id, data: '2026-09-20', orientacoesPaciente: 'x'.repeat(2000) }), app.db);
    for (let i = 0; i < 9; i++) await withTenant(C.T.ctx, (tx) => tx.insert(consultations).values({ tenantId: C.T.tenantId, patientId: C.p.id, data: `2026-09-${10 + i}`, orientacoesPaciente: 'y'.repeat(2000) }), app.db);
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await tarefa(C, tarefaId)).toMatchObject({ erro: 'limite_custo', saiuEm: null });
    expect((await uso(C, tarefaId)).situacao).toBe('estornado');
    expect(await saidas(C, tarefaId)).toHaveLength(0);
  });

  it('D12: no portão, a reserva desce ao teto do pedido que sai (nunca sobe)', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const antes = (await tarefa(C, tarefaId)).reservaMicroUsd;
    const f = provedorFake({ gerar: [new ErroProvedor('incerto', null, null)] });
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('falhou');
    const t = await tarefa(C, tarefaId);
    expect(t.reservaMicroUsd).toBeLessThan(antes);
    // resultado incerto: a reserva (já reduzida) fica como custo
    expect(t.erro).toBe('resultado_incerto');
    expect(await uso(C, tarefaId)).toMatchObject({ situacao: 'incerto', custoMicroUsd: t.reservaMicroUsd });
  });

  it('RN-105: 529 antes de processar → relança (sem enviado_em, saiu_em fica); a nova tentativa grava o início de agora (R7) e conclui', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const f = provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'req-1')] });
    await expect(processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).rejects.toBeInstanceOf(RepetirIaError);
    const t1 = await tarefa(C, tarefaId);
    expect(t1).toMatchObject({ status: 'processando', enviadoEm: null, destino: 'teste' });
    expect(t1.saiuEm).not.toBeNull();
    // R7: a nova tentativa 14 min depois grava o início dela; a varredura 5 min depois não a interrompe
    const depois = new Date(agora.getTime() + 14 * 60_000);
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f, { agora: () => depois }))).toBe('pronta');
    const t2 = await tarefa(C, tarefaId);
    expect(t2.iniciadoEm!.getTime()).toBe(depois.getTime());
    expect(t2.tentativas).toBe(2);
    expect(t2.saiuEm!.getTime()).toBe(t1.saiuEm!.getTime());
  });

  it('R7: a nova tentativa grava o início dela — a varredura não interrompe a tarefa que acabou de recomeçar', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const lento: ProvedorIA = { ...provedorFake(), gerar: async () => { throw new ErroProvedor('repetir', 529, null); } };
    await expect(processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(lento))).rejects.toBeInstanceOf(RepetirIaError);
    const depois = new Date(agora.getTime() + 14 * 60_000);
    // a nova tentativa começa e o provedor responde "repetir" de novo: o início dela fica gravado
    await expect(processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(lento, { agora: () => depois }))).rejects.toBeInstanceOf(RepetirIaError);
    expect((await tarefa(C, tarefaId)).iniciadoEm!.getTime()).toBe(depois.getTime());
    const r = await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, new Date(agora.getTime() + 19 * 60_000), 'teste'), app.db);
    expect(r.interrompidas).toBe(0);
    expect((await tarefa(C, tarefaId)).status).toBe('processando');
  });

  it('D4: nova tentativa com enviado_em gravado → resultado_incerto, sem reenviar', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => tx.update(iaTarefas).set({ status: 'processando', enviadoEm: agora, saiuEm: agora, destino: 'teste' }).where(eq(iaTarefas.id, tarefaId)), app.db);
    const f = provedorFake();
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect((await tarefa(C, tarefaId)).erro).toBe('resultado_incerto');
    expect((await uso(C, tarefaId)).situacao).toBe('incerto');
  });

  it('resposta fora do formato, recusa e nenhuma frase com fonte → falhou com o custo acertado', async () => {
    for (const [resposta, erro] of [
      [finalOk('{'), 'resposta_invalida'],
      [{ tipo: 'recusa' as const, categoria: 'cyber', bruto: [], uso: { entrada: 10, cacheLeitura: 0, cacheGravacao: 0, saida: 1, geo: 'us' }, requestId: 'r' }, 'recusa'],
      [finalOk({ secoes: [{ secao: 'evolucao', frases: [{ texto: 'Sem fonte.', fontes: [] }] }] }), 'nada_encontrado'],
    ] as const) {
      const C = await cenario();
      const { tarefaId } = await pedir(C);
      expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(provedorFake({ gerar: [resposta] })))).toBe('falhou');
      expect(await tarefa(C, tarefaId)).toMatchObject({ status: 'falhou', erro, resultado: null, parametros: null });
      expect((await uso(C, tarefaId)).situacao).toBe('confirmado');
    }
  });

  it('retirada durante a chamada: o resultado não é gravado (o custo é)', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const f = provedorFake({ gerar: [finalOk({ secoes: [{ secao: 'evolucao', frases: [{ texto: 'O peso caiu.', fontes: ['#1'] }] }] })] });
    const lento: ProvedorIA = {
      ...f,
      gerar: async (p) => {
        await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
        return f.gerar(p);
      },
    };
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(lento))).toBe('falhou');
    expect(await tarefa(C, tarefaId)).toMatchObject({ erro: 'sem_autorizacao', resultado: null });
    expect((await uso(C, tarefaId)).situacao).toBe('confirmado');
  });

  it('tarefa cancelada durante a chamada (retirada + varredura, D15 da 14A) → o resultado não é gravado; a reserva fica incerta', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    const f = provedorFake();
    const lento: ProvedorIA = {
      ...f,
      gerar: async (p) => {
        // a retirada pela nutricionista deixa a "processando" para o worker; a varredura a cancela (já saiu: incerta)
        await registrarRetiradaPelaNutri(C.T.ctx, C.p.id, { db: app.db });
        await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, agora, 'teste'), app.db);
        return f.gerar(p);
      },
    };
    expect(await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(lento))).toBe('falhou');
    expect(await tarefa(C, tarefaId)).toMatchObject({ status: 'cancelada', resultado: null, parametros: null });
    expect((await uso(C, tarefaId)).situacao).toBe('incerto');
  });
});

describe('abrirResumo (US-120, RN-108, regra 8)', () => {
  it('abre com auditRead (entidade ia); depois da retirada, não abre', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C, true);
    await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(provedorSandbox()));
    const r = await abrirResumo(C.T.ctx, C.p.id, tarefaId, { db: app.db, destino: 'teste' });
    expect(r?.secoes.length).toBeGreaterThan(0);
    expect(r).toMatchObject({ tarefaId, retiradas: 1, notasPrivadas: true });
    expect(r?.fontes.length).toBeGreaterThan(0);
    expect((await listAccessHistory(C.T.ctx, C.p.id, 1, app.db)).itens.some((i) => i.acao === 'ler' && i.entidade === 'ia' && i.entidadeId === tarefaId)).toBe(true);
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    expect(await abrirResumo(C.T.ctx, C.p.id, tarefaId, { db: app.db, destino: 'teste' })).toBeNull();
  });

  it('vencida, de outro paciente, de outro destino ou id inválido → null, sem auditoria', async () => {
    const C = await cenario();
    const { tarefaId } = await pedir(C);
    await processarResumo({ tenantId: C.T.tenantId, tarefaId }, jobDeps(provedorSandbox()));
    const outro = await novoPaciente(app.db, C.T.ctx);
    expect(await abrirResumo(C.T.ctx, outro.id, tarefaId, { db: app.db, destino: 'teste' })).toBeNull();
    expect(await abrirResumo(C.T.ctx, C.p.id, tarefaId, { db: app.db, destino: 'anthropic-us' })).toBeNull();
    expect(await abrirResumo(C.T.ctx, C.p.id, tarefaId, { db: app.db, destino: 'teste', agora: new Date(agora.getTime() + 8 * 86_400_000) })).toBeNull();
    expect(await abrirResumo(C.T.ctx, C.p.id, 'x', { db: app.db, destino: 'teste' })).toBeNull();
    const leituras = await withTenant(C.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, tarefaId), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras).toHaveLength(0);
  });
});
