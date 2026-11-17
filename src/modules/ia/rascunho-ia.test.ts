import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, prontuarioCompleto } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, iaTarefas, iaUso, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { criarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { buscarAlimentos, type AlimentoEncontrado } from '@/modules/alimentos/busca';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { carregarPlano, listarPlanosDoPaciente } from '@/modules/plano-alimentar/carregar';
import { criarRascunho } from '@/modules/plano-alimentar/rascunho';
import { listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { MSG_IA, MSG_RASCUNHO_IA } from './constantes';
import { buscaDoTenant } from './ferramentas-alimentos';
import type { DepsJobAssistente } from './modelos-job';
import type { ProvedorIA } from './provedor';
import { finalOk, pedeFerramenta, provedorFake } from './provedor-fake';
import { abrirRascunhoIa, MetasError, metasPadrao, pedirRascunhoIa, RascunhoExisteError, RascunhoIaError, REFEICOES_COMUNS, usarComoRascunho } from './rascunho-ia';
import { processarRascunho } from './rascunho-job';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [{ nome: 'Cevada, cozida', nomeOriginal: 'Barley, pearled, cooked', kcal: 123, proteinaG: 2.3, carboidratoG: 28.2, lipidioG: 0.4, fibraG: 3.8 }]);
});
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await apagarPublicos(owner.pool, [usda]);
  await app.pool.end();
  await owner.pool.end();
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

async function cenario(o: { autorizacao?: { versao?: string; usos?: string[] } } = {}) {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  await autorizacaoNoBanco(app.db, T.tenantId, p.id, o.autorizacao ?? {});
  await prontuarioCompleto(app.db, T.ctx, p.id);
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, p, tenant: tenant as TenantRow };
}
type Cenario = Awaited<ReturnType<typeof cenario>>;
const tarefa = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0];
const uso = async (C: Cenario, id: string) => (await withTenant(C.T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0];
const rascunhosDe = async (C: Cenario) => (await listarPlanosDoPaciente(C.T.ctx, C.p.id, app.db)).filter((p) => p.status === 'rascunho');

/** A busca do tenant, com o arroz da TACO (idTaco(3)) em primeiro — o "A1" da tarefa — e os `extras` depois. */
const buscaComArroz =
  (extras: AlimentoEncontrado[] = []) =>
  (tenantId: string) =>
  async (termo: string) => {
    const achados = await buscaDoTenant(tenantId, app.db)(termo);
    const arroz = achados.find((a) => a.id === idTaco(3)) ?? (await buscaDoTenant(tenantId, app.db)('arroz tipo 1 cozido')).find((a) => a.id === idTaco(3));
    if (!arroz) throw new Error('o arroz da TACO (idTaco(3)) não foi achado');
    return [arroz, ...extras, ...achados.filter((a) => a.id !== arroz.id)];
  };
const plano = (itens: { alimento: string; gramas: number; substitui?: number | null }[]) => ({
  titulo: 'Plano',
  meta_kcal: 1800,
  orientacoes: '',
  refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: itens.map((i) => ({ alimento: i.alimento, gramas: i.gramas, medida: null, substitui: i.substitui ?? null })) }],
});

/** Pede e processa com o fake: busca "arroz" → plano com A1 (150 g). */
async function rascunhoPronto(C: Cenario, o: { itens?: Parameters<typeof plano>[0]; extras?: AlimentoEncontrado[] } = {}): Promise<string> {
  const id = await pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, deps);
  const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz tipo 1 cozido' }), finalOk(plano(o.itens ?? [{ alimento: 'A1', gramas: 150 }]))] });
  expect(await processarRascunho({ tenantId: C.T.tenantId, tarefaId: id }, jobDeps(f, { buscar: buscaComArroz(o.extras) }))).toBe('pronta');
  return id;
}

describe('metasPadrao (US-121)', () => {
  it('com cálculos, a meta é a do mais recente; com plano, as refeições com horário dele; sem nada, as seis comuns', () => {
    const doPlano = { refeicoes: [{ id: 'a', nome: 'Desjejum', horario: '06:30', observacao: '', itens: [] }, { id: 'b', nome: 'Sem hora', horario: '', observacao: '', itens: [] }] };
    expect(metasPadrao([{ kcal: 2100 }, { kcal: 1900 }], doPlano)).toEqual({ metaKcal: 2100, refeicoes: [{ nome: 'Desjejum', horario: '06:30' }] });
    const vazio = metasPadrao([], null);
    expect(vazio).toEqual({ metaKcal: null, refeicoes: REFEICOES_COMUNS.map((r) => ({ ...r })) });
    expect(vazio.refeicoes).toHaveLength(6);
    // plano sem nenhuma refeição com horário: as comuns
    expect(metasPadrao([], { refeicoes: [doPlano.refeicoes[1]] }).refeicoes).toHaveLength(6);
  });
});

describe('pedirRascunhoIa (US-121, RN-100, RN-104)', () => {
  it('valida as metas (erros por campo), reserva o teto do rascunho e grava as metas em parametros; "Pediu rascunho à IA"; a fila só com ids', async () => {
    const C = await cenario();
    await expect(pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, { ...metas, metaKcal: '100' }, deps)).rejects.toMatchObject({ erros: { metaKcal: 'Meta deve estar entre 500 e 10000 kcal' } });
    await expect(pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, { ...metas, lipidioPct: '10' }, deps)).rejects.toBeInstanceOf(MetasError);
    const id = await pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, deps);
    const t = await tarefa(C, id);
    expect(t).toMatchObject({
      tipo: 'rascunho_plano', status: 'na_fila', pedidoPor: C.T.nutriId, modelo: 'claude-sonnet-5-5', promptVersao: 'rascunho-2026-10-14', reservaMicroUsd: 1_000_000, carimboDados: null,
      parametros: { metaKcal: 1800, proteinaPct: 20, carboidratoPct: 50, lipidioPct: 30, restricoes: 'Sem lactose.', considerarAnamnese: true },
    });
    expect(await uso(C, id)).toMatchObject({ situacao: 'reservado', custoMicroUsd: 1_000_000, tipo: 'rascunho_plano' });
    const h = await listAccessHistory(C.T.ctx, C.p.id, 1, app.db);
    expect(h.itens.map(rotuloDaAcao)).toContain('Pediu rascunho à IA');
    const jobs = await (await getBoss()).findJobs<Record<string, unknown>>('ia-assistente');
    expect(jobs.filter((j) => j.data.tarefaId === id).map((j) => j.data)).toEqual([{ tenantId: C.T.tenantId, tarefaId: id }]);
  });

  it('sem autorização para o rascunho → texto da US-105; retirada → texto da retirada; um rascunho de IA em andamento por paciente', async () => {
    const sem = await cenario({ autorizacao: { usos: ['leitura_laudos', 'resumo_historico'] } });
    await expect(pedirRascunhoIa(sem.T.ctx, sem.tenant, sem.p.id, metas, deps)).rejects.toMatchObject({ mensagem: MSG_IA.semAutorizacao });
    const retirou = await cenario();
    await autorizacaoNoBanco(app.db, retirou.T.tenantId, retirou.p.id, { evento: 'retirou' });
    await expect(pedirRascunhoIa(retirou.T.ctx, retirou.tenant, retirou.p.id, metas, deps)).rejects.toMatchObject({ mensagem: MSG_IA.retirouAutorizacao });
    const C = await cenario();
    await pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, deps);
    await expect(pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, deps)).rejects.toMatchObject({ mensagem: MSG_RASCUNHO_IA.emAndamento });
    for (const x of [sem, retirou]) expect(await withTenant(x.T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toEqual([]);
  });

  it('IA sem retenção aceita ou aditivo desatualizado → recusado sem tarefa; paciente bloqueado → PacienteBloqueadoError', async () => {
    const C = await cenario();
    await expect(pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, { ...deps, ia: { ...IA_TESTE, retencao: null } })).rejects.toMatchObject({ mensagem: MSG_IA.indisponivel });
    await expect(pedirRascunhoIa(C.T.ctx, { ...C.tenant, iaAditivoVersao: '1.0' }, C.p.id, metas, deps)).rejects.toMatchObject({ mensagem: MSG_IA.aditivoDesatualizado });
    await app.db.update(tenants).set({ iaAditivoVersao: '1.0' }).where(eq(tenants.id, C.T.tenantId));
    // D16: a cópia da action diz "ativa", a linha travada não
    await expect(pedirRascunhoIa(C.T.ctx, C.tenant, C.p.id, metas, deps)).rejects.toMatchObject({ mensagem: MSG_IA.aditivoDesatualizado });
    const B = await cenario();
    await withTenant(B.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, B.p.id)), app.db);
    await expect(pedirRascunhoIa(B.T.ctx, B.tenant, B.p.id, metas, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    for (const x of [C, B]) expect(await withTenant(x.T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toEqual([]);
  });
});

describe('usarComoRascunho (US-121, RN-122, A-D12, RN-117)', () => {
  it('cria o rascunho com ia_origem_em e os itens, e marca a tarefa aplicada na mesma transação', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C);
    const r = await usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: false }, { db: app.db, destino: 'teste', agora });
    expect(r.foraDoCatalogo).toBe(0);
    const plano = (await carregarPlano(C.T.ctx, r.planId, app.db))!;
    expect(plano).toMatchObject({ status: 'rascunho', metaKcal: 1800, titulo: 'Plano', iaOrigemEm: agora.toISOString(), versao: 2 }); // o publicado do prontuário é a v1
    expect(plano.refeicoes[0].itens).toHaveLength(1);
    expect(plano.refeicoes[0].itens[0]).toMatchObject({ foodId: idTaco(3), quantidadeG: 150 });
    expect(await tarefa(C, id)).toMatchObject({ status: 'aplicada', resultado: null, parametros: null, linhasAplicadas: 1, encerradoPor: C.T.nutriId });
    // usar de novo: a tarefa já foi aplicada
    await expect(usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: true }, { db: app.db, destino: 'teste' })).rejects.toMatchObject({ mensagem: MSG_IA.indisponivelSugestao });
  });

  it('já existe rascunho: recusa sem "substituir"; com "substituir", o atual sai e o da IA entra (A-D12)', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C);
    const { id: antigo } = await criarRascunho(C.T.ctx, C.p.id, { db: app.db });
    await expect(usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: false }, { db: app.db, destino: 'teste' })).rejects.toBeInstanceOf(RascunhoExisteError);
    expect((await tarefa(C, id)).status).toBe('pronta'); // nada mudou
    const r = await usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: true }, { db: app.db, destino: 'teste' });
    expect(await carregarPlano(C.T.ctx, antigo, app.db)).toBeNull();
    expect(r.planId).not.toBe(antigo);
    expect((await rascunhosDe(C)).map((p) => p.id)).toEqual([r.planId]);
  });

  it('autorização retirada depois de pronto → "Esta sugestão não está mais disponível." e nada é gravado (RN-108)', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C);
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    await expect(usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: false }, { db: app.db, destino: 'teste' })).rejects.toMatchObject({ mensagem: MSG_IA.indisponivelSugestao });
    expect(await rascunhosDe(C)).toEqual([]);
    expect((await tarefa(C, id)).status).toBe('pronta');
  });

  it('outro paciente, outro destino, vencida e id inválido → indisponível, sem gravar', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C);
    const outro = await novoPaciente(app.db, C.T.ctx);
    for (const [paciente, tarefaId, d] of [
      [outro.id, id, { destino: 'teste' as const }],
      [C.p.id, id, { destino: 'anthropic-us' as const }],
      [C.p.id, id, { destino: 'teste' as const, agora: new Date(agora.getTime() + 8 * 86_400_000) }],
      [C.p.id, 'x', { destino: 'teste' as const }],
    ] as const) {
      await expect(usarComoRascunho(C.T.ctx, paciente, tarefaId, { substituir: true }, { db: app.db, ...d })).rejects.toBeInstanceOf(RascunhoIaError);
    }
    expect(await rascunhosDe(C)).toEqual([]);
    expect(await listarPlanosDoPaciente(C.T.ctx, outro.id, app.db)).toEqual([]);
  });

  it('D15: alimento excluído entre a geração e o uso → o item sai e é contado; a prévia mostra o mesmo', async () => {
    const C = await cenario();
    const { id: foodId } = await criarAlimento(C.T.ctx, { nome: 'Pão low carb Marca X', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' }, { db: app.db });
    const meu = (await buscaDoTenant(C.T.tenantId, app.db)('Pão low carb Marca X')).find((a) => a.id === foodId)!;
    expect(meu).toBeDefined();
    const id = await rascunhoPronto(C, { extras: [meu], itens: [{ alimento: 'A1', gramas: 150 }, { alimento: 'A2', gramas: 50 }] });
    await excluirAlimento(C.T.ctx, foodId, { db: app.db });
    const previa = (await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'teste' }))!;
    expect(previa.foraDoCatalogo).toBe(1);
    expect(previa.plano.refeicoes[0].itens.map((i) => i.foodId)).toEqual([idTaco(3)]);
    const r = await usarComoRascunho(C.T.ctx, C.p.id, id, { substituir: false }, { db: app.db, destino: 'teste' });
    expect(r.foraDoCatalogo).toBe(1);
    expect((await carregarPlano(C.T.ctx, r.planId, app.db))!.refeicoes[0].itens).toHaveLength(1);
    expect((await tarefa(C, id)).linhasAplicadas).toBe(1);
  });
});

describe('abrirRascunhoIa (US-121, RN-108, regra 8)', () => {
  it('totais pelo calculo.ts com os valores atuais dos alimentos e auditRead (entidade ia)', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C, { itens: [{ alimento: 'A1', gramas: 150 }, { alimento: 'A1', gramas: 100, substitui: 1 }] });
    const previa = (await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'teste' }))!;
    expect(previa).toMatchObject({ tarefaId: id, descartados: 0, foraDoCatalogo: 0 });
    expect(previa.plano).toMatchObject({ status: 'rascunho', metaKcal: 1800, titulo: 'Plano', iaOrigemEm: null, origemIa: null });
    const [principal, sub] = previa.plano.refeicoes[0].itens;
    expect(principal).toMatchObject({ foodId: idTaco(3), quantidadeG: 150, origem: 'TACO', substituiItemId: null });
    expect(principal.porCem.kcal).toBeGreaterThan(0);
    expect(sub).toMatchObject({ quantidadeG: 100, substituiItemId: principal.id });
    expect((await listAccessHistory(C.T.ctx, C.p.id, 1, app.db)).itens.some((i) => i.acao === 'ler' && i.entidade === 'ia' && i.entidadeId === id)).toBe(true);
  });

  it('RN-230: alimento da USDA que chegue ao resultado pelo id (a ferramenta não o devolve) sai na prévia com a fonte de foods.fonte', async () => {
    const C = await cenario();
    const cevada = (await buscarAlimentos(C.T.ctx, 'cevada cozida', app.db, { fontes: ['usda'] })).find((a) => a.id === usda)!;
    expect(cevada).toBeDefined();
    const id = await rascunhoPronto(C, { extras: [cevada], itens: [{ alimento: 'A1', gramas: 150 }, { alimento: 'A2', gramas: 100 }] });
    const previa = (await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'teste' }))!;
    expect(previa.plano.refeicoes[0].itens.map((i) => [i.foodId, i.fonte, i.origem])).toEqual([
      [idTaco(3), 'taco', 'TACO'],
      [usda, 'usda', 'USDA (EUA)'],
    ]);
  });

  it('retirada, outro paciente, outro destino, vencida ou id inválido → null, sem auditoria', async () => {
    const C = await cenario();
    const id = await rascunhoPronto(C);
    const outro = await novoPaciente(app.db, C.T.ctx);
    expect(await abrirRascunhoIa(C.T.ctx, outro.id, id, { db: app.db, destino: 'teste' })).toBeNull();
    expect(await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'anthropic-us' })).toBeNull();
    expect(await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'teste', agora: new Date(agora.getTime() + 8 * 86_400_000) })).toBeNull();
    expect(await abrirRascunhoIa(C.T.ctx, C.p.id, 'x', { db: app.db, destino: 'teste' })).toBeNull();
    await autorizacaoNoBanco(app.db, C.T.tenantId, C.p.id, { evento: 'retirou' });
    expect(await abrirRascunhoIa(C.T.ctx, C.p.id, id, { db: app.db, destino: 'teste' })).toBeNull();
    const leituras = await withTenant(C.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, id), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras).toHaveLength(0);
  });
});
