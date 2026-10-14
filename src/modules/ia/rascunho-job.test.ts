import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, prontuarioCompleto } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { processarJobAssistente } from './assistente-job';
import { CATEGORIAS_POR_USO } from './campos-enviados';
import { buscaDoTenant } from './ferramentas-alimentos';
import { custoMaximoDaPrimeiraVolta } from './laco-ferramentas';
import { expirarTarefasDoTenant, RepetirIaError } from './leitura-job';
import type { DepsJobAssistente } from './modelos-job';
import { custoMaximoMicroUsd, custoMicroUsd, MAX_TOKENS_VOLTA } from './precos';
import type { ProvedorIA } from './provedor';
import { ErroProvedor, finalOk, pedeFerramenta, provedorFake, USO_FAKE } from './provedor-fake';
import { provedorSandbox } from './provedor-sandbox';
import { pedirRascunhoIa } from './rascunho-ia';
import { processarRascunho } from './rascunho-job';

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
const metas = {
  metaKcal: '1800',
  proteinaPct: '20',
  carboidratoPct: '50',
  lipidioPct: '30',
  refeicoes: [
    { nome: 'Almoço', horario: '12:00' },
    { nome: 'Jantar', horario: '19:30' },
  ],
  restricoes: 'Sem lactose.',
  considerarAnamnese: true,
};
const planoOk = (itens: { alimento: string; gramas: number }[] = [{ alimento: 'A1', gramas: 150 }], meta = 1800) => ({
  titulo: 'P',
  meta_kcal: meta,
  orientacoes: '',
  refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: itens.map((i) => ({ ...i, medida: null, substitui: null })) }],
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
const pedir = (C: Cenario, m: Record<string, unknown> = metas, ia = IA_TESTE) => pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, m, { ...deps, ia });
const enviado = (f: ReturnType<typeof provedorFake>, i = 0) => {
  const t = f.chamadas.gerar[i].turnos[0] as unknown as { blocos: { texto: string }[] };
  return JSON.parse(t.blocos[0].texto.split('\n').at(-1)!) as Record<string, unknown>;
};
const saidas = async (C: Cenario, tarefaId: string) =>
  withTenant(C.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, tarefaId), eq(auditLog.acao, 'exportar'))), app.db);

describe('processarRascunho (US-121, US-122, §5.6, RN-121)', () => {
  it('portão: "Dados enviados à IA"; só idade, sexo, metas e anamnese saem; o modelo busca e devolve; item inválido descartado', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk([{ alimento: 'A1', gramas: 150 }, { alimento: 'A1', gramas: 9000 }]))] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('pronta');
    const dados = enviado(f);
    expect(Object.keys(dados).sort()).toEqual(['anamnese', 'idade', 'metas', 'sexo']);
    for (const k of Object.keys(dados)) expect(CATEGORIAS_POR_USO.rascunho_plano).toContain(k);
    expect(JSON.stringify(dados)).not.toContain(C.p.nome);
    expect(f.chamadas.gerar[0]).toMatchObject({ finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', esforco: 'medium', maxTokens: MAX_TOKENS_VOLTA });
    expect(f.chamadas.gerar[0].ferramentas.map((x) => x.nome)).toEqual(['buscar_alimentos', 'calcular_plano']);
    expect(f.chamadas.gerar[1].turnos).toHaveLength(3); // só cresce: usuário, assistente (bruto), resultados
    expect(f.chamadas.gerar[1].turnos[0]).toEqual(f.chamadas.gerar[0].turnos[0]);
    const t = await tarefa(C, id);
    expect(t).toMatchObject({ status: 'pronta', destino: 'teste', carimboDados: null, reservaMicroUsd: 1_000_000 }); // D5: a reserva é o teto, não desce
    expect(t.saiuEm).not.toBeNull();
    expect(t.expiraEm!.getTime()).toBe(agora.getTime() + 7 * 86_400_000);
    expect(t.resultado).toMatchObject({ tipo: 'rascunho', versao: 1, plano: { titulo: 'P', metaKcal: 1800, descartados: 1, refeicoes: [{ nome: 'Almoço', itens: [{ quantidadeG: 150 }] }] } });
    const u = await uso(C, id);
    expect(u).toMatchObject({ situacao: 'confirmado', custoMicroUsd: 2 * custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE), tokensEntrada: 2 * USO_FAKE.entrada, tokensSaida: 2 * USO_FAKE.saida }); // acerto pela soma
    expect(t.custoMicroUsd).toBe(u.custoMicroUsd);
    const h = await listAccessHistory(C.T.ctx, C.p.id, 1, app.db);
    expect(h.itens.map(rotuloDaAcao)).toEqual(expect.arrayContaining(['Pediu rascunho à IA', 'Dados enviados à IA']));
    expect(h.itens.find((i) => i.entidade === 'ia' && i.acao === 'exportar')?.ator).toBeNull(); // o worker ("Sistema")
  });

  it('"Considerar a anamnese" desmarcada: a anamnese não sai', async () => {
    const C = await cenario();
    const id = await pedir(C, { ...metas, considerarAnamnese: false });
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('pronta');
    expect(Object.keys(enviado(f)).sort()).toEqual(['idade', 'metas', 'sexo']);
  });

  it('RN-02/RN-116: a meta é a da nutricionista, nunca o número do modelo', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk(undefined, 2500))] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('pronta');
    expect((await tarefa(C, id)).resultado).toMatchObject({ plano: { metaKcal: 1800 } });
  });

  it('o roteador da fila ia-assistente leva a tarefa de rascunho a processarRascunho (sandbox, busca real do tenant)', async () => {
    const C = await cenario();
    const id = await pedir(C);
    expect(await processarJobAssistente({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(provedorSandbox()))).toBe('pronta');
    const t = await tarefa(C, id);
    expect(t.status).toBe('pronta');
    expect((t.resultado as { plano: { refeicoes: unknown[] } }).plano.refeicoes.length).toBeGreaterThan(0);
  });

  it('US-122: retirada no meio do laço → para na volta seguinte com sem_autorizacao; cobra só o que saiu; nada mais sai', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk({})] });
    const buscar = () => async () => {
      await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
      return [];
    };
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { buscar }))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(1);
    expect(await tarefa(C, id)).toMatchObject({ status: 'falhou', erro: 'sem_autorizacao', resultado: null, parametros: null, custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
    expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
  });

  it('IA do consultório desativada ou tarefa cancelada no meio do laço → para na volta seguinte (ia_desligada / interrompida)', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    const desliga = () => async () => {
      await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, C.T.tenantId));
      return [];
    };
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { buscar: desliga }))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(1);
    expect(await tarefa(C, id)).toMatchObject({ erro: 'ia_desligada', resultado: null });
    expect((await uso(C, id)).situacao).toBe('confirmado');

    const D = await cenario();
    const id2 = await pedir(D);
    const g = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    const varre = () => async () => {
      // a varredura (ou o cancelamento) encerra a tarefa enquanto o laço corre: nada mais sai, a reserva fica incerta
      await withTenant({ tenantId: D.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, new Date(agora.getTime() + 16 * 60_000), 'teste'), app.db);
      return [];
    };
    expect(await processarRascunho({ tenantId: D.T.tenantId, tarefaId: id2 }, jobDeps(g, { buscar: varre }))).toBe('falhou');
    expect(g.chamadas.gerar).toHaveLength(1);
    expect(await tarefa(D, id2)).toMatchObject({ status: 'falhou', erro: 'interrompida', resultado: null });
    expect((await uso(D, id2)).situacao).toBe('incerto');
  });

  it('US-122: 12 voltas sem plano → limite_voltas', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: Array.from({ length: 13 }, (_, i) => pedeFerramenta('buscar_alimentos', { termo: 'x' }, `c${i}`)) });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(12);
    expect(await tarefa(C, id)).toMatchObject({ erro: 'limite_voltas', resultado: null, parametros: null });
    expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: 12 * custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
  });

  it('R9 — US-122: teto pequeno (IA_TETO_RASCUNHO_USD) → limite_custo antes da 2ª volta; uma chamada; acerto da que saiu', async () => {
    const C = await cenario();
    // a 2ª volta reenvia ≥ 11.000 tokens (os 10.000 de entrada + 1.000 de saída da 1ª): o custo da 1ª + o máximo da 2ª
    // passam do teto; a 1ª (instruções + metas, bem menos de 11.000 tokens) cabe
    const teto = custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) + custoMaximoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE.entrada + USO_FAKE.saida, MAX_TOKENS_VOLTA) - 1;
    const id = await pedir(C, metas, { ...IA_TESTE, tetoRascunhoMicroUsd: teto });
    expect((await tarefa(C, id)).reservaMicroUsd).toBe(teto);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(1);
    expect(await tarefa(C, id)).toMatchObject({ status: 'falhou', erro: 'limite_custo', resultado: null });
    expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
  });

  it('RN-104/RN-101 (revisão da T10): teto que não comporta nem a 1ª volta → limite_custo NO PORTÃO; nada sai, nada se registra como enviado, estorno', async () => {
    const C = await cenario();
    // o custo máximo da 1ª volta deste paciente, pela mesma conta do laço, a partir do que de fato saiu numa 1ª volta
    const f0 = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: await pedir(C) }, jobDeps(f0))).toBe('pronta');
    const primeira = f0.chamadas.gerar[0];
    const exato = custoMaximoDaPrimeiraVolta(primeira, (primeira.turnos[0] as unknown as { blocos: { texto: string }[] }).blocos[0].texto);
    // IA_TETO_RASCUNHO_USD no mínimo do env (0,05) e o custo máximo da 1ª volta − 1: nenhum dos dois comporta a volta
    for (const teto of [50_000, exato - 1]) {
      const id = await pedir(C, metas, { ...IA_TESTE, tetoRascunhoMicroUsd: teto });
      const f = provedorFake({ gerar: [finalOk(planoOk())] });
      expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
      expect(f.chamadas.gerar).toHaveLength(0);
      expect(await tarefa(C, id)).toMatchObject({ status: 'falhou', erro: 'limite_custo', enviadoEm: null, saiuEm: null, destino: null, parametros: null, resultado: null });
      expect(await saidas(C, id)).toHaveLength(0); // sem "Dados enviados à IA"
      expect((await uso(C, id)).situacao).toBe('estornado');
    }
    // no limite exato a 1ª volta cabe (a conferência do portão não é mais rígida que a do laço); a 2ª não, e o laço para
    const id = await pedir(C, metas, { ...IA_TESTE, tetoRascunhoMicroUsd: exato });
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(1);
    expect(await tarefa(C, id)).toMatchObject({ erro: 'limite_custo' });
    expect((await tarefa(C, id)).saiuEm).not.toBeNull();
    expect(await saidas(C, id)).toHaveLength(1);
    expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
  });

  it('resposta sem refeição válida, fora do formato e recusa → falhou com o custo acertado', async () => {
    for (const [resposta, erro] of [
      [finalOk(planoOk([{ alimento: 'A99', gramas: 100 }])), 'resposta_invalida'],
      [finalOk('{'), 'resposta_invalida'],
      [{ tipo: 'recusa' as const, categoria: 'cyber', bruto: [], uso: USO_FAKE, requestId: 'r' }, 'recusa'],
    ] as const) {
      const C = await cenario();
      const id = await pedir(C);
      const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), resposta] });
      expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
      expect(await tarefa(C, id)).toMatchObject({ status: 'falhou', erro, resultado: null, parametros: null });
      expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: 2 * custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
    }
  });

  it('CS-105 pelo portão: autorização retirada antes do envio → nada sai (sem_autorizacao), estorno, sem "Dados enviados à IA"', async () => {
    const C = await cenario();
    const id = await pedir(C);
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    const f = provedorFake();
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await tarefa(C, id)).toMatchObject({ status: 'falhou', erro: 'sem_autorizacao', saiuEm: null, parametros: null });
    expect((await uso(C, id)).situacao).toBe('estornado');
    expect(await saidas(C, id)).toHaveLength(0);
  });

  it('sem a retenção aceita no worker → ia_desligada, sem chamada, estorno', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake();
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { retencao: null }))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await tarefa(C, id)).toMatchObject({ erro: 'ia_desligada', saiuEm: null });
    expect((await uso(C, id)).situacao).toBe('estornado');
  });

  it('RN-105 / R7: 529 na 1ª volta → relança (sem enviado_em, saiu_em fica); a nova tentativa grava o início dela e a varredura não a interrompe', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const lento: ProvedorIA = { ...provedorFake(), gerar: async () => { throw new ErroProvedor('repetir', 529, null); } };
    await expect(processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(lento))).rejects.toBeInstanceOf(RepetirIaError);
    const t1 = await tarefa(C, id);
    expect(t1).toMatchObject({ status: 'processando', enviadoEm: null, destino: 'teste' });
    expect(t1.saiuEm).not.toBeNull();
    // a nova tentativa 14 min depois grava o início dela; o provedor responde "repetir" de novo
    const depois = new Date(agora.getTime() + 14 * 60_000);
    await expect(processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(lento, { agora: () => depois }))).rejects.toBeInstanceOf(RepetirIaError);
    expect((await tarefa(C, id)).iniciadoEm!.getTime()).toBe(depois.getTime());
    const r = await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, new Date(depois.getTime() + 5 * 60_000), 'teste'), app.db);
    expect(r.interrompidas).toBe(0);
    // a terceira conclui
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { agora: () => depois }))).toBe('pronta');
    const t3 = await tarefa(C, id);
    expect(t3.tentativas).toBe(3);
    expect(t3.saiuEm!.getTime()).toBe(t1.saiuEm!.getTime());
  });

  it('RN-105 na última tentativa → provedor_indisponivel com estorno', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [new ErroProvedor('repetir', 529, null)] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { ultimaTentativa: true }))).toBe('falhou');
    expect(await tarefa(C, id)).toMatchObject({ erro: 'provedor_indisponivel' });
    expect((await uso(C, id)).situacao).toBe('estornado');
  });

  it('D4: da 2ª volta em diante nada repete — 529 → provedor_indisponivel com o acerto da 1ª; tempo esgotado → resultado_incerto, reserva mantida', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), new ErroProvedor('repetir', 529, 'req-2')] });
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(await tarefa(C, id)).toMatchObject({ erro: 'provedor_indisponivel', custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE) });
    expect(await uso(C, id)).toMatchObject({ situacao: 'confirmado', custoMicroUsd: custoMicroUsd('claude-sonnet-5-5', 'us', USO_FAKE), requestId: 'req-2' });

    const D = await cenario();
    const id2 = await pedir(D);
    const g = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), new ErroProvedor('incerto', null, null)] });
    expect(await processarRascunho({ tenantId: D.T.tenantId, tarefaId: id2 }, jobDeps(g))).toBe('falhou');
    expect(await tarefa(D, id2)).toMatchObject({ erro: 'resultado_incerto' });
    expect(await uso(D, id2)).toMatchObject({ situacao: 'incerto', custoMicroUsd: 1_000_000 });
  });

  it('D4: nova tentativa com enviado_em gravado → resultado_incerto, sem reenviar', async () => {
    const C = await cenario();
    const id = await pedir(C);
    await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => tx.update(iaTarefas).set({ status: 'processando', enviadoEm: agora, saiuEm: agora, destino: 'teste' }).where(eq(iaTarefas.id, id)), app.db);
    const f = provedorFake();
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect((await tarefa(C, id)).erro).toBe('resultado_incerto');
    expect((await uso(C, id)).situacao).toBe('incerto');
  });

  it('retirada depois da última volta, antes de gravar: o resultado não é gravado (o custo é)', async () => {
    const C = await cenario();
    const id = await pedir(C);
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(planoOk())] });
    const lento: ProvedorIA = {
      ...f,
      gerar: async (p) => {
        const r = await f.gerar(p);
        if (r.tipo === 'final') await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
        return r;
      },
    };
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(lento, { buscar: (t) => buscaDoTenant(t, app.db) }))).toBe('falhou');
    expect(await tarefa(C, id)).toMatchObject({ erro: 'sem_autorizacao', resultado: null });
    expect((await uso(C, id)).situacao).toBe('confirmado');
  });

  it('tarefa já encerrada ou inexistente → ignorada, sem chamada', async () => {
    const C = await cenario();
    const id = await pedir(C);
    await withTenant({ tenantId: C.T.tenantId, role: 'worker' }, (tx) => tx.update(iaTarefas).set({ status: 'falhou', erro: 'interrompida', parametros: null }).where(eq(iaTarefas.id, id)), app.db);
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(provedorFake()))).toBe('ignorada');
    expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: '00000000-0000-4000-8000-000000000000' }, jobDeps(provedorFake()))).toBe('ignorada');
  });
});
