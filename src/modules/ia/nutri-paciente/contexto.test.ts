import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  app,
  comoWorker,
  depsApp,
  depsDoJob,
  editarEPublicarDeNovo,
  fecharHarnessDaConversa,
  finalOk,
  ORIENTACOES_DO_PLANO,
  outroPacientePronto,
  pronto,
  TACO_ARROZ,
  TACO_BANANA,
  TACO_MACA,
} from '../../../../test/ia-nutri-conversa';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import type { TenantDeTeste } from '../../../../test/pacientes';
import { planoEmRascunho, planoPublicado, type RefeicaoDeTeste } from '../../../../test/plano';
import { mealPlans, referenciasNutrientes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import type { DiaDaSemana } from '@/modules/plano-alimentar/dias';
import { ligarLista } from '@/modules/plano-alimentar/ligados';
import { salvarLista } from '@/modules/plano-alimentar/listas';
import { editarPublicado, publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { quantidadeDoItem } from '@/modules/portal/plano';
import { CATEGORIAS_DA_IA_NUTRI } from '../campos-enviados';
import { custoMaximoMicroUsd, MAX_TOKENS_CONVERSA, TOKENS_ENTRADA_TETO_CONVERSA, TOKENS_INSTRUCOES_TETO, tokensDeBytes } from '../precos';
import { provedorFake } from '../provedor-fake';
import {
  BYTES_DA_RESERVA,
  cabeNaReserva,
  contextoDoPlano,
  corpoDaConversa,
  MARCADOR_RESUMIDO,
  montarContexto,
  relerTrechos,
  turnoDaConversa,
  type ItemDoHistorico,
  type PlanoDoContexto,
} from './contexto';
import { encaminhar, enviarANutri, perguntar } from './conversa';
import { SISTEMA_CONVERSA } from './instrucoes';
import { processarPerguntaIaNutri } from './job';

// Plano 15 (P15-09): o contexto da pergunta, lido na sessão de paciente sem conta (spec F3-02 v0.4 §4.2 passo 2, §7.3,
// RN-172, RN-174, RNF-163, DP-8, DP-16, Review Focus 6)
afterAll(fecharHarnessDaConversa);

type Historico = { autor: string; texto?: string; tipo_resposta?: string | null; fontes?: string[] }[];
const historicoDe = (c: { dados: Record<string, unknown> }) => (c.dados.perguntas as { historico: Historico }).historico;
type Refeicao = { indice: string; nome: string; horario: string | null; itens: { indice: string; alimento: string; quantidade: string; kcal: string | null }[]; substituicoes: { indice: string; substitui: string | null; kcal: string | null }[] };
const refeicoesDe = (c: { dados: Record<string, unknown> }) => (c.dados.plano as { refeicoes: Refeicao[] }).refeicoes;
const publicadoDe = async (T: Awaited<ReturnType<typeof pronto>>['T'], patientId: string) =>
  (await withTenant(T.ctx, (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado'))), app.db))[0].id;

describe('montarContexto (§7.3, RNF-163)', () => {
  it('as chaves de topo são exatamente CATEGORIAS_DA_IA_NUTRI; índices locais; nenhuma id do banco; nada de rascunho nem de arquivado', async () => {
    const { T, p, ctxP } = await pronto();
    // uma versão arquivada (a publicação nova arquiva a anterior) e um rascunho aberto: nenhum dos dois entra
    await editarEPublicarDeNovo(T, p.id);
    const vigente = await publicadoDe(T, p.id);
    await editarPublicado(T.ctx, p.id, vigente, { db: app.db });
    const { mensagemId } = await perguntar(ctxP, 'o que posso comer no lugar da banana à tarde?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    expect(c.planId).toBe(vigente);
    expect(Object.keys(c.dados).sort()).toEqual([...CATEGORIAS_DA_IA_NUTRI].sort());
    expect(c.fontes.map((f) => f.indice)).toEqual(['#R1', '#I1', '#R2', '#I2', '#S1', '#O1', '#A1', '#A2']);
    expect(c.fontes.map((f) => f.tipo)).toEqual(['refeicao', 'item', 'refeicao', 'item', 'substituicao', 'orientacao_plano', 'orientacao_atendimento', 'orientacao_atendimento']);
    expect(JSON.stringify(c.dados)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // nenhum uuid sai
    expect(c.corpo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    const [almoco, lanche] = refeicoesDe(c);
    expect(almoco).toMatchObject({ indice: '#R1', nome: 'Almoço', horario: '12:30', itens: [{ indice: '#I1', alimento: 'Arroz, tipo 1, cozido' }], substituicoes: [] });
    expect(lanche).toMatchObject({ indice: '#R2', nome: 'Lanche da tarde', horario: '16:00', itens: [{ indice: '#I2', alimento: 'Banana, prata, crua' }], substituicoes: [{ indice: '#S1', substitui: '#I2' }] });
    // os atendimentos: o mais recente primeiro (#A1)
    expect(c.dados.orientacoes).toEqual([
      { indice: '#A1', data: '2026-09-01', texto: 'Evite frituras, [removido].' },
      { indice: '#A2', data: '2026-08-01', texto: 'Caminhe 30 minutos por dia.' },
    ]);
  });

  it('máscara: o nome do paciente, o nome da nutricionista e o do consultório viram [removido]; o CPF da pergunta também', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId: comCpf } = await perguntar(ctxP, 'meu CPF é 123.456.789-09, Ana pode trocar a banana?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: comCpf! }))!;
    const s = JSON.stringify(c.dados);
    expect(s).not.toMatch(/Debby|Ana|Souza|123\.456\.789-09/);
    expect(s).toContain('[removido]');
    expect(c.corpo).not.toMatch(/Debby|Ana|Souza|123\.456\.789-09/);
    // a pergunta crua fica com o worker (validação e termos), nunca no corpo
    expect(c.pergunta).toBe('meu CPF é 123.456.789-09, Ana pode trocar a banana?');
  });

  it('kcal só com mostrar_calorias do plano; a formatação é a da tela (quantidadeDoItem)', async () => {
    const sem = await pronto();
    const r1 = await perguntar(sem.ctxP, 'quanto de arroz no almoço?', depsApp);
    const c1 = (await montarContexto(app.db, { tenantId: sem.T.tenantId, patientId: sem.p.id, mensagemId: r1.mensagemId! }))!;
    for (const r of refeicoesDe(c1)) {
      for (const i of r.itens) expect(i.kcal).toBeNull();
      for (const s of r.substituicoes) expect(s.kcal).toBeNull();
    }
    expect(refeicoesDe(c1)[0].itens[0].quantidade).toBe(quantidadeDoItem({ quantidadeG: 100, medidaCaseiraTxt: null }));
    const com = await pronto({ mostrarCalorias: true });
    const r2 = await perguntar(com.ctxP, 'quanto de arroz no almoço?', depsApp);
    const c2 = (await montarContexto(app.db, { tenantId: com.T.tenantId, patientId: com.p.id, mensagemId: r2.mensagemId! }))!;
    const [almoco, lanche] = refeicoesDe(c2);
    expect(almoco.itens[0].kcal).toBe('128 kcal'); // TACO: 128 kcal em 100 g
    expect(lanche.substituicoes[0].kcal).toMatch(/^\d+ kcal$/);
  });

  it('as 6 últimas mensagens da MESMA sessão vão no histórico; sessão anterior não; das respostas `ia`, só tipo_resposta e fontes', async () => {
    const { T, p, ctxP } = await pronto();
    // a sessão anterior (há 2 h): uma pergunta que saiu e foi respondida
    const antes = new Date(Date.now() - 2 * 3_600_000);
    await mensagemNoBanco(app.db, T.tenantId, p.id, { texto: 'pergunta da sessão anterior', status: 'respondida', sessaoInicio: antes, createdAt: antes, enviadoEm: antes, saiuEm: antes, destino: 'teste' });
    for (const n of [1, 2, 3, 4]) {
      const { mensagemId } = await perguntar(ctxP, `o que posso comer no lugar da banana (${n})?`, depsApp);
      const fake = provedorFake({ gerar: [finalOk({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] })] });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(fake))).toBe('respondida');
    }
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const ia = { autor: 'ia', tipo_resposta: 'substituicao', fontes: ['#S1'] };
    expect(historicoDe(c)).toEqual([
      { autor: 'paciente', texto: 'o que posso comer no lugar da banana (2)?' }, ia,
      { autor: 'paciente', texto: 'o que posso comer no lugar da banana (3)?' }, ia,
      { autor: 'paciente', texto: 'o que posso comer no lugar da banana (4)?' }, ia,
    ]);
    expect(c.corpo).not.toMatch(/sessão anterior|banana \(1\)/);
    expect(c.corpo).not.toMatch(/No seu plano, as opções/); // o texto montado nunca volta ao modelo (DP-8)
  });

  it('RN-174: a pergunta barrada pelo filtro de risco NÃO vai no histórico da pergunta seguinte da mesma sessão', async () => {
    const { T, p, ctxP } = await pronto();
    expect((await perguntar(ctxP, 'não aguento mais, quero sumir e me machucar', depsApp)).codigo).toBe('risco'); // barrada: texto fixo, sem job
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp); // mesma sessão (< 30 min)
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    expect(c.corpo).not.toMatch(/sumir|machucar/);
    expect(historicoDe(c)).toEqual([]);
  });

  it('DP-16: a dúvida enviada direto à nutricionista NÃO vai no histórico da pergunta seguinte da mesma sessão', async () => {
    const { T, p, ctxP } = await pronto();
    expect((await enviarANutri(ctxP, 'posso trocar o jantar de dia? só para a Debby ler', depsApp)).codigo).toBe('encaminhada'); // sem IA, sem job
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp); // mesma sessão (< 30 min)
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    expect(c.corpo).not.toMatch(/trocar o jantar|só para/);
    expect(historicoDe(c)).toEqual([]);
  });

  it('a pergunta que não saiu (cancelada no passo 1, `enviado_em` nulo) não vai no histórico; a que saiu e foi encaminhada depois vai', async () => {
    const { T, p, ctxP } = await pronto();
    const naoSaiu = (await perguntar(ctxP, 'qual o horário do lanche?', depsApp)).mensagemId!;
    const nada = provedorFake({ gerar: [] });
    await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: naoSaiu }, depsDoJob(nada, { nutriDesligada: true })); // cancelada no passo 1: nada sai
    expect(nada.chamadas.gerar).toHaveLength(0);
    const saiu = (await perguntar(ctxP, 'o que posso comer no lugar da banana à tarde?', depsApp)).mensagemId!;
    await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: saiu }, depsDoJob(provedorFake({ gerar: [finalOk({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] })] })));
    expect(await encaminhar(ctxP, saiu, depsApp)).toBe('encaminhada'); // encaminhada DEPOIS de sair: continua no histórico
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const h = historicoDe(c);
    expect(h.filter((x) => x.autor === 'paciente').map((x) => x.texto)).toEqual(['o que posso comer no lugar da banana à tarde?']);
    expect(c.corpo).not.toMatch(/horário do lanche/);
  });

  it('o corpo leva histórico e pergunta UMA vez, no topo; `contexto` tem só plano, orientações e índices; bytes = corpo + instruções', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const turno = JSON.parse(c.corpo.slice(c.corpo.indexOf('\n') + 1));
    expect(Object.keys(turno).sort()).toEqual(['contexto', 'historico', 'pergunta']);
    expect(Object.keys(turno.contexto).sort()).toEqual(['indices', 'orientacoes', 'plano']);
    expect(turno.contexto.indices).toEqual(c.fontes.map((f) => f.indice));
    expect(turno.pergunta).toBe('quanto de arroz no almoço?');
    expect(c.corpo.split('quanto de arroz no almoço?')).toHaveLength(2); // uma vez só
    expect(c.bytes).toBe(Buffer.byteLength(c.corpo) + Buffer.byteLength(SISTEMA_CONVERSA));
    // a mesma função pura que a avaliação (T13) usa
    expect(corpoDaConversa({ plano: c.dados.plano, orientacoes: c.dados.orientacoes }, c.fontes, historicoDe(c) as never, turno.pergunta)).toBe(c.corpo);
  });

  it('nenhuma linha "ler" de plano_alimentar é gravada pela montagem (auditar: false)', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
    const ler = () => comoWorker(T, sql`select count(*)::int as n from audit_log where patient_id = ${p.id} and acao = 'ler'`);
    const [antes] = await ler();
    await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! });
    expect(await ler()).toEqual([antes]);
  });

  it('mensagem de outro paciente → null (a RLS da sessão de paciente)', async () => {
    const { T, p, ctxP } = await pronto();
    const outro = await outroPacientePronto(T);
    const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
    // a RLS da sessão de paciente não deixa o outro paciente ler a mensagem deste
    expect(await montarContexto(app.db, { tenantId: T.tenantId, patientId: outro.p.id, mensagemId: mensagemId! })).toBeNull();
    expect(await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! })).not.toBeNull();
  });
});

describe('relerTrechos (§4.2 passo 5, RN-172)', () => {
  it('só o plano publicado com o MESMO id; id de outro paciente ou plano republicado → null', async () => {
    const { T, p, ctxP } = await pronto();
    const outro = await outroPacientePronto(T);
    const { mensagemId } = await perguntar(ctxP, 'o que posso comer no lugar da banana à tarde?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const s1 = c.fontes.filter((f) => f.indice === '#S1');
    expect(await relerTrechos(app.db, { tenantId: T.tenantId, patientId: p.id, planId: c.planId }, s1, 'substituicao')).toEqual([
      { indice: '#S1', fonte: 'Lanche da tarde — substituições', texto: expect.stringMatching(/^Maçã, Fuji, com casca, crua — /) },
    ]);
    expect(await relerTrechos(app.db, { tenantId: T.tenantId, patientId: outro.p.id, planId: c.planId }, s1, 'substituicao')).toBeNull();
    await editarEPublicarDeNovo(T, p.id); // a publicação arquiva a versão anterior (publicacao.ts)
    expect(await relerTrechos(app.db, { tenantId: T.tenantId, patientId: p.id, planId: c.planId }, s1, 'substituicao')).toBeNull();
  });

  it('cada tipo de fonte com o texto da tela (sem máscara: o paciente lê o próprio plano)', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'qual o horário do almoço?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const f = (i: string) => c.fontes.filter((x) => x.indice === i);
    const reler = (i: string, tipo: Parameters<typeof relerTrechos>[3]) => relerTrechos(app.db, { tenantId: T.tenantId, patientId: p.id, planId: c.planId }, f(i), tipo);
    expect(await reler('#R1', 'horario')).toEqual([{ indice: '#R1', fonte: 'Almoço — horário', texto: 'Almoço: 12:30' }]);
    expect(await reler('#R2', 'refeicao')).toEqual([{ indice: '#R2', fonte: 'Lanche da tarde — itens', texto: expect.stringMatching(/^Lanche da tarde \(16:00\): Banana, prata, crua — /) }]);
    expect(await reler('#I1', 'quantidade')).toEqual([{ indice: '#I1', fonte: 'Almoço — itens', texto: `Arroz, tipo 1, cozido — ${quantidadeDoItem({ quantidadeG: 100, medidaCaseiraTxt: null })}` }]);
    expect(await reler('#O1', 'orientacao')).toEqual([{ indice: '#O1', fonte: 'Orientações do plano', texto: 'Beba água. Qualquer dúvida, fale com a Debby.' }]);
    expect(await reler('#A1', 'orientacao')).toEqual([{ indice: '#A1', fonte: 'Atendimento de 01/09/2026 — orientações', texto: 'Evite frituras, Ana.' }]);
    // uma fonte com o tipo trocado (item dito substituição) → null
    expect(await relerTrechos(app.db, { tenantId: T.tenantId, patientId: p.id, planId: c.planId }, [{ ...f('#I1')[0], tipo: 'substituicao' }], 'substituicao')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Plano 19, Tarefa 10c (RN-255, RN-247 (h), RN-240, D25; R-239 / PM-PA9)
// ---------------------------------------------------------------------------------------------------------------------

const TACO_BATATA_DOCE = 88;
const TACO_MANDIOCA = 129;
const SABADO = new Date('2026-11-14T15:00:00Z'); // sábado, 12:00 em São Paulo
const QUARTA = new Date('2026-11-11T15:00:00Z');
const SEG_A_SEX = [1, 2, 3, 4, 5];
const SAB_E_DOM = [0, 6];

const publicar = async (T: TenantDeTeste, patientId: string, planId: string) => {
  const r = await publicarPlano(T.ctx, patientId, planId, { db: app.db });
  if (r.avisos) await publicarPlano(T.ctx, patientId, planId, { db: app.db }, { confirmarAvisos: r.avisos });
};

/**
 * Plano com alimentos, dias e a lista ligada: "Almoço" (arroz, com a batata-doce como substituição), "Lanche da tarde" de
 * segunda a sexta (banana) e de sábado e domingo (maçã); a lista "Trocas do dia a dia" com a orientação citando o paciente
 * ("Ana") e dois grupos; um perfil de referência (nunca sai). Publicado pelos serviços de verdade.
 */
async function planoComLista(T: TenantDeTeste, patientId: string) {
  const refeicoes: RefeicaoDeTeste[] = [
    { nome: 'Almoço', horario: '12:30', itens: [{ gramas: 100, taco: TACO_ARROZ }, { gramas: 150, taco: TACO_BATATA_DOCE, substitui: 0 }] },
    { nome: 'Lanche da tarde', horario: '16:00', dias: SEG_A_SEX, itens: [{ gramas: 100, taco: TACO_BANANA }] },
    { nome: 'Lanche da tarde', horario: '16:30', dias: SAB_E_DOM, itens: [{ gramas: 130, taco: TACO_MACA }] },
  ];
  const plano = await planoEmRascunho(app.db, T, patientId, { mostrarCalorias: true, orientacoes: ORIENTACOES_DO_PLANO, refeicoes });
  const grupo = (nome: string, itens: [number, string][]) => ({ id: randomUUID(), nome, itens: itens.map(([taco, g]) => ({ id: randomUUID(), foodId: idTaco(taco), quantidadeG: g, medida: null })) });
  const { id: listaId } = await salvarLista(
    T.ctx,
    null,
    { nome: 'Trocas do dia a dia', orientacao: 'Ana, troque só dentro do mesmo grupo.', grupos: [grupo('Carboidratos — 1 porção', [[TACO_ARROZ, '100'], [TACO_MANDIOCA, '100']]), grupo('Frutas — 1 porção', [[TACO_BANANA, '100']])] },
    { db: app.db },
  );
  await ligarLista(T.ctx, { planId: plano.planId, patientId }, listaId, { db: app.db });
  const [perfil] = await withTenant(
    T.ctx,
    (tx) => tx.insert(referenciasNutrientes).values({ tenantId: T.tenantId, nome: 'PERFIL-MARCADOR', fonte: 'FONTE-PERFIL-MARCADOR', valores: { ferro_mg: { meta: 18, maximo: 45 } } }).returning(),
    app.db,
  );
  await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ referenciaId: perfil.id }).where(eq(mealPlans.id, plano.planId)), app.db);
  await publicar(T, patientId, plano.planId);
}

/** Plano em texto livre: "Almoço" (todos os dias, o texto cita o paciente) e "Jantar" de segunda a sexta. */
const planoLivre = (T: TenantDeTeste, patientId: string) =>
  planoPublicado(app.db, T, patientId, {
    modo: 'livre',
    mostrarCalorias: true,
    orientacoes: ORIENTACOES_DO_PLANO,
    refeicoes: [
      { nome: 'Almoço', horario: '12:30', itens: [], descricaoLivre: 'Arroz, feijão e salada à vontade. Ana, capriche na salada.' },
      { nome: 'Jantar', horario: '19:30', dias: SEG_A_SEX, itens: [], observacao: 'Sem fritura.', descricaoLivre: 'Sopa de legumes com frango.' },
    ],
  });

type PlanoNoContexto = {
  hoje: string;
  kcal_do_dia: string | null;
  refeicoes: Record<string, unknown>[];
  listas: { nome: string; orientacao?: string | null; resumido?: string; grupos: Record<string, unknown>[] }[];
  orientacoes: unknown[];
};
const planoDe = (c: { dados: Record<string, unknown> }) => c.dados.plano as PlanoNoContexto;

describe('Plano 19 — o contexto com dias, texto livre e lista de substituição (RN-255, RN-247 (h), RN-240)', () => {
  it('dias de cada refeição e o dia de hoje no fuso do consultório; kcal do dia do perfil de hoje; lista mascarada com #L; nenhum micro nem perfil', async () => {
    const { T, p, ctxP } = await pronto({ plano: planoComLista });
    const { mensagemId } = await perguntar(ctxP, 'posso trocar o arroz por quê?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId!, agora: SABADO }))!;
    expect(c.fontes.map((f) => f.indice)).toEqual(['#R1', '#I1', '#S1', '#R2', '#I2', '#R3', '#I3', '#L1-1', '#L1-2', '#O1', '#A1', '#A2']);
    expect(c.fontes.filter((f) => f.tipo === 'lista_substituicao').map((f) => f.grupo)).toEqual([0, 1]);
    const plano = planoDe(c);
    expect(Object.keys(plano).sort()).toEqual(['hoje', 'kcal_do_dia', 'listas', 'orientacoes', 'refeicoes']);
    expect(plano.hoje).toBe('sáb');
    expect(plano.kcal_do_dia).toBe('201 kcal'); // sábado: arroz (128) + maçã de 130 g (72,8); nunca a soma dos dois lanches
    expect(plano.refeicoes.map((r) => r.dias)).toEqual([['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'], ['seg', 'ter', 'qua', 'qui', 'sex'], ['sáb', 'dom']]);
    expect(plano.listas).toEqual([
      {
        nome: 'Trocas do dia a dia',
        orientacao: '[removido], troque só dentro do mesmo grupo.',
        grupos: [
          { indice: '#L1-1', nome: 'Carboidratos — 1 porção', itens: [{ alimento: 'Arroz, tipo 1, cozido', quantidade: '100 g', kcal: '128 kcal' }, { alimento: 'Mandioca, cozida', quantidade: '100 g', kcal: '125 kcal' }] },
          { indice: '#L1-2', nome: 'Frutas — 1 porção', itens: [{ alimento: 'Banana, prata, crua', quantidade: '100 g', kcal: '98 kcal' }] },
        ],
      },
    ]);
    // a projeção é fechada: só estas chaves em cada refeição e item (RN-240: micros e perfil nunca entram)
    for (const r of plano.refeicoes) expect(Object.keys(r).sort()).toEqual(['dias', 'horario', 'indice', 'itens', 'nome', 'observacao', 'substituicoes']);
    expect(Object.keys((plano.refeicoes[0].itens as object[])[0]).sort()).toEqual(['alimento', 'indice', 'kcal', 'quantidade']);
    for (const s of [JSON.stringify(c.dados), c.corpo]) {
      expect(s).not.toMatch(/micros|_mg|_mcg|PERFIL-MARCADOR|referencia|\bAna\b|Souza|Debby/);
      expect(s).not.toContain(MARCADOR_RESUMIDO); // plano pequeno: nada resumido
    }
    expect(c.resumido).toBe(false);
    // num dia de semana, o perfil de hoje é o outro
    const quarta = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId!, agora: QUARTA }))!;
    expect(planoDe(quarta)).toMatchObject({ hoje: 'qua', kcal_do_dia: '226 kcal' }); // arroz (128) + banana (98)
  });

  it('virada do dia no fuso do consultório (America/Manaus): domingo 23:59 → segunda 00:00', async () => {
    const { T, p, ctxP } = await pronto({ plano: planoComLista });
    await withTenant(T.ctx, (tx) => tx.update(tenants).set({ fuso: 'America/Manaus' }).where(eq(tenants.id, T.tenantId)), app.db);
    const { mensagemId } = await perguntar(ctxP, 'o que tem no lanche?', depsApp);
    const domingo = new Date('2026-11-16T03:59:00Z'); // 23:59 de domingo em Manaus (UTC−4); já segunda em São Paulo
    const segunda = new Date('2026-11-16T04:00:00Z');
    expect(planoDe((await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId!, agora: domingo }))!).hoje).toBe('dom');
    expect(planoDe((await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId!, agora: segunda }))!).hoje).toBe('seg');
  });

  it('texto livre: a descricao_livre mascarada é o trecho #R (sem itens); sem cálculo, nenhuma kcal (RN-243)', async () => {
    const { T, p, ctxP } = await pronto({ plano: planoLivre });
    const { mensagemId } = await perguntar(ctxP, 'o que tem no almoço?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId!, agora: SABADO }))!;
    expect(c.fontes.map((f) => f.indice)).toEqual(['#R1', '#R2', '#O1', '#A1', '#A2']);
    const plano = planoDe(c);
    expect(plano.kcal_do_dia).toBeNull();
    expect(plano.refeicoes).toEqual([
      { indice: '#R1', nome: 'Almoço', horario: '12:30', dias: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'], observacao: null, texto_livre: 'Arroz, feijão e salada à vontade. [removido], capriche na salada.', itens: [], substituicoes: [] },
      { indice: '#R2', nome: 'Jantar', horario: '19:30', dias: ['seg', 'ter', 'qua', 'qui', 'sex'], observacao: 'Sem fritura.', texto_livre: 'Sopa de legumes com frango.', itens: [], substituicoes: [] },
    ]);
    expect(c.corpo).not.toMatch(/\bAna\b|kcal"\s*:\s*"/);
  });
});

describe('Plano 19 — relerTrechos e a resposta (RN-255; Review Focus 5)', () => {
  it('o grupo da lista relido da cópia publicada, com a fonte "Lista de substituição — {grupo}"; texto livre com a fonte "— texto do plano"; dias no trecho', async () => {
    const comLista = await pronto({ plano: planoComLista });
    const r1 = await perguntar(comLista.ctxP, 'posso trocar o arroz por quê?', depsApp);
    const c = (await montarContexto(app.db, { tenantId: comLista.T.tenantId, patientId: comLista.p.id, mensagemId: r1.mensagemId! }))!;
    const reler = (i: string, tipo: Parameters<typeof relerTrechos>[3]) =>
      relerTrechos(app.db, { tenantId: comLista.T.tenantId, patientId: comLista.p.id, planId: c.planId }, c.fontes.filter((f) => f.indice === i), tipo);
    expect(await reler('#L1-1', 'substituicao')).toEqual([{ indice: '#L1-1', fonte: 'Lista de substituição — Carboidratos — 1 porção', texto: 'Arroz, tipo 1, cozido — 100 g · 128 kcal; Mandioca, cozida — 100 g · 125 kcal' }]);
    expect(await reler('#R3', 'horario')).toEqual([{ indice: '#R3', fonte: 'Lanche da tarde — horário', texto: 'Lanche da tarde: 16:30 (sáb e dom)' }]);
    expect(await reler('#R2', 'refeicao')).toEqual([{ indice: '#R2', fonte: 'Lanche da tarde — itens', texto: 'Lanche da tarde (16:00, seg a sex): Banana, prata, crua — 100 g · 98 kcal' }]);
    // R-236: o item (#I) de uma refeição de alguns dias traz os dias na fonte; o dos 7 dias, não
    expect(await reler('#I2', 'quantidade')).toEqual([{ indice: '#I2', fonte: 'Lanche da tarde (seg a sex) — itens', texto: 'Banana, prata, crua — 100 g · 98 kcal' }]);
    expect(await reler('#I3', 'quantidade')).toEqual([{ indice: '#I3', fonte: 'Lanche da tarde (sáb e dom) — itens', texto: expect.stringMatching(/^Maçã, Fuji, com casca, crua — 130 g/) }]);
    expect(await reler('#I1', 'quantidade')).toEqual([{ indice: '#I1', fonte: 'Almoço — itens', texto: 'Arroz, tipo 1, cozido — 100 g · 128 kcal' }]);
    // um grupo que não existe na cópia → null
    const l = c.fontes.find((f) => f.indice === '#L1-2')!;
    expect(await relerTrechos(app.db, { tenantId: comLista.T.tenantId, patientId: comLista.p.id, planId: c.planId }, [{ ...l, grupo: 9 }], 'substituicao')).toBeNull();

    const livre = await pronto({ plano: planoLivre });
    const r2 = await perguntar(livre.ctxP, 'o que tem no almoço?', depsApp);
    const cl = (await montarContexto(app.db, { tenantId: livre.T.tenantId, patientId: livre.p.id, mensagemId: r2.mensagemId! }))!;
    const releia = (i: string) => relerTrechos(app.db, { tenantId: livre.T.tenantId, patientId: livre.p.id, planId: cl.planId }, cl.fontes.filter((f) => f.indice === i), 'refeicao');
    expect(await releia('#R1')).toEqual([{ indice: '#R1', fonte: 'Almoço — texto do plano', texto: 'Almoço (12:30): Arroz, feijão e salada à vontade. Ana, capriche na salada.' }]);
    expect(await releia('#R2')).toEqual([{ indice: '#R2', fonte: 'Jantar — texto do plano', texto: 'Jantar (19:30, seg a sex): Sopa de legumes com frango. Sem fritura.' }]);
  });

  it('Review Focus 5: o modelo devolve ["#L1-1", "#S1"] e a resposta cita a substituição do almoço antes da lista (spec 19, "IA Nutri e a lista")', async () => {
    const { T, p, ctxP } = await pronto({ plano: planoComLista });
    const { mensagemId } = await perguntar(ctxP, 'posso trocar o arroz por quê?', depsApp);
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#L1-1', '#S1'] })] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(fake))).toBe('respondida');
    const [ia] = await comoWorker(T, sql`select texto, fontes from ia_nutri_mensagens where patient_id = ${p.id} and autor = 'ia'`);
    expect(ia.fontes).toEqual(['#L1-1', '#S1']);
    expect(ia.texto).toMatch(
      /^No seu plano, as opções de substituição são:\nBatata, doce, cozida — 150 g · \d+ kcal\nFonte: Almoço — substituições\nArroz, tipo 1, cozido — 100 g · 128 kcal; Mandioca, cozida — 100 g · 125 kcal\nFonte: Lista de substituição — Carboidratos — 1 porção\nIsto é/,
    );
  });
});

// R-239 (PM-PA9): o contexto do plano cabe na reserva por prioridade — puro, sem banco
const porCem = { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 };
const alvo = { nome: 'Ana Souza', email: null, telefone: null };
function planoGrande(o: { refeicoes: number; itens: number; listas: number; nome: string; medida: string | null; observacao: string; diasDa: (k: number) => DiaDaSemana[] }): PlanoDoContexto {
  const porRefeicao = Math.ceil(o.itens / o.refeicoes);
  let n = 0;
  return {
    id: 'p',
    modo: 'calculado',
    mostrarCalorias: true,
    orientacoes: 'Beba água ao longo do dia e evite açúcar. '.repeat(48).slice(0, 2000),
    refeicoes: Array.from({ length: o.refeicoes }, (_, r) => ({
      id: `r${r}`,
      nome: `Refeição ${r + 1} — ${'n'.repeat(60)}`.slice(0, 60),
      horario: '12:30',
      observacao: o.observacao,
      diasSemana: o.diasDa(r),
      descricaoLivre: null,
      itens: Array.from({ length: Math.max(0, Math.min(porRefeicao, o.itens - r * porRefeicao)) }, (_, j) => {
        n++;
        return { id: `i${n}`, nome: o.nome, quantidadeG: 100, medidaCaseiraTxt: o.medida, porCem, substituiItemId: j % 2 ? `i${n - 1}` : null };
      }),
    })),
    listas: Array.from({ length: o.listas }, (_, l) => ({
      id: `l${l}`,
      nome: `Lista ${l + 1} ${'x'.repeat(80)}`.slice(0, 80),
      orientacao: 'Troque só dentro do grupo, na quantidade da lista. '.repeat(20).slice(0, 1000),
      grupos: Array.from({ length: 20 }, (_, g) => ({
        nome: `Grupo ${g + 1} — ${'g'.repeat(60)}`.slice(0, 60),
        itens: Array.from({ length: 30 }, () => ({ nome: o.nome, quantidadeG: 100, medidaCaseiraTxt: o.medida, porCem })),
      })),
    })),
  };
}
/** "Notas e histórico no máximo": 5 orientações de atendimento de 5.000 caracteres, 3 perguntas de 500 e 3 respostas com 4 fontes, a pergunta com 500. */
function turnoNoMaximo(plano: PlanoDoContexto, hoje: DiaDaSemana) {
  const orientacoes = Array.from({ length: 5 }, (_, k) => ({ indice: `#A${k + 1}`, data: '2026-09-01', texto: 'Evite açúcar e frituras; prefira água. '.repeat(130).slice(0, 5000) }));
  const fontesDosAtendimentos = orientacoes.map((a, k) => ({ indice: a.indice, tipo: 'orientacao_atendimento' as const, id: `a${k}` }));
  const historico: ItemDoHistorico[] = Array.from({ length: 3 }, () => [
    { autor: 'paciente' as const, texto: 'Posso trocar a refeição de hoje? '.repeat(16).slice(0, 500) },
    { autor: 'ia' as const, tipo_resposta: 'substituicao', fontes: ['#S100', '#S101', '#L5-20', '#L4-19'] },
  ]).flat();
  return turnoDaConversa({ plano, alvo, hoje, orientacoes, fontesDosAtendimentos, historico, pergunta: 'O que posso comer no lugar do arroz hoje? '.repeat(12).slice(0, 500) });
}
const semLimiteDeCusto = (bytes: number) =>
  custoMaximoMicroUsd('claude-haiku-5-5', 'us', tokensDeBytes(bytes) + TOKENS_INSTRUCOES_TETO, MAX_TOKENS_CONVERSA) <=
  custoMaximoMicroUsd('claude-haiku-5-5', 'us', TOKENS_ENTRADA_TETO_CONVERSA, MAX_TOKENS_CONVERSA);

describe('R-239 / PM-PA9: o contexto do plano cabe na reserva da pergunta, por prioridade', () => {
  it('50 refeições / 400 itens + 5 listas cheias (20 × 30), nomes de 120 caracteres, notas e histórico no máximo → montado ≤ reserva, sem limite_custo', () => {
    const plano = planoGrande({ refeicoes: 50, itens: 400, listas: 5, nome: 'N'.repeat(120), medida: 'M'.repeat(60), observacao: 'Mastigue devagar. '.repeat(120).slice(0, 2000), diasDa: (k) => (k % 2 ? [1, 2, 3, 4, 5] : [0, 6]) });
    const inteiro = contextoDoPlano(plano, alvo, 1); // sem orçamento: o plano inteiro (a medição de antes)
    expect(cabeNaReserva(Buffer.byteLength(JSON.stringify(inteiro.plano)))).toBe(false);
    const t = turnoNoMaximo(plano, 1);
    expect(t.bytes).toBeLessThanOrEqual(BYTES_DA_RESERVA);
    expect(t.bytes).toBe(Buffer.byteLength(t.corpo) + Buffer.byteLength(SISTEMA_CONVERSA));
    expect(cabeNaReserva(t.bytes)).toBe(true);
    expect(semLimiteDeCusto(t.bytes)).toBe(true); // o teto do portão (job.ts) nunca passa da reserva
    expect(t.resumido).toBe(true);
    expect(t.corpo).toContain(MARCADOR_RESUMIDO);
    // os nomes de cada lista e de cada grupo sempre vão, com o índice
    const p = JSON.parse(t.corpo.slice(t.corpo.indexOf('\n') + 1)).contexto.plano as PlanoNoContexto;
    expect(p.listas).toHaveLength(5);
    for (const l of p.listas) expect(l.grupos.map((g) => g.indice)).toHaveLength(20);
    expect(p.refeicoes).toHaveLength(50);
    // todo índice do contexto aponta para uma parte enviada; a parte resumida não leva itens nem índices de item
    const indices = new Set(t.fontes.map((f) => f.indice));
    for (const r of p.refeicoes) {
      if (r.resumido) expect(r.itens).toBeUndefined();
      else for (const i of r.itens as { indice: string }[]) expect(indices.has(i.indice)).toBe(true);
    }
  });

  it('a prioridade: refeições de hoje completas antes das dos outros dias; depois as listas', () => {
    // 6 refeições, cada uma com observação longa; hoje = segunda: R1, R3 e R5 valem na segunda
    const plano = planoGrande({ refeicoes: 6, itens: 12, listas: 1, nome: 'Arroz, tipo 1, cozido', medida: '4 colheres de sopa', observacao: 'o'.repeat(2000), diasDa: (k) => (k % 2 ? [6] : [1]) });
    const esqueleto = contextoDoPlano(plano, alvo, 1, 0);
    const base = Buffer.byteLength(JSON.stringify(esqueleto.plano)) + esqueleto.fontes.reduce((t, f) => t + Buffer.byteLength(f.indice) + 3, 0);
    const c = contextoDoPlano(plano, alvo, 1, base + 3 * 2400); // cabem 3 refeições completas
    const refeicoes = (c.plano as PlanoNoContexto).refeicoes;
    expect(refeicoes.map((r) => (r.resumido ? 'resumida' : 'completa'))).toEqual(['completa', 'resumida', 'completa', 'resumida', 'completa', 'resumida']);
    expect(refeicoes[1]).toEqual({ indice: '#R2', nome: refeicoes[1].nome, horario: '12:30', dias: ['sáb'], resumido: MARCADOR_RESUMIDO });
    expect((c.plano as PlanoNoContexto).listas[0].grupos.every((g) => g.resumido === MARCADOR_RESUMIDO)).toBe(true);
    // os índices dos itens não mudam com o resumo (contadores do plano inteiro): R3 continua com #I3
    expect(c.fontes.map((f) => f.indice).filter((i) => i.startsWith('#I'))).toEqual(['#I1', '#I3', '#I5']);
    expect(c.resumido).toBe(true);
    // com folga, tudo completo e nenhum marcador
    const tudo = contextoDoPlano(plano, alvo, 1);
    expect(tudo.resumido).toBe(false);
    expect(JSON.stringify(tudo.plano)).not.toContain(MARCADOR_RESUMIDO);
  });

  it('15 refeições / 200 itens sem lista (o limite de antes), notas e histórico no máximo → nenhum marcador', () => {
    const plano = planoGrande({ refeicoes: 15, itens: 200, listas: 0, nome: 'Arroz, tipo 1, cozido', medida: '4 colheres de sopa', observacao: 'Mastigue devagar e beba água entre as refeições.', diasDa: () => [0, 1, 2, 3, 4, 5, 6] });
    const t = turnoNoMaximo(plano, 3);
    expect(t.resumido).toBe(false);
    expect(t.corpo).not.toContain(MARCADOR_RESUMIDO);
    expect(cabeNaReserva(t.bytes)).toBe(true);
  });
});
