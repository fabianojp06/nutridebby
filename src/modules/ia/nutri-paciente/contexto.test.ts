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
  outroPacientePronto,
  pronto,
} from '../../../../test/ia-nutri-conversa';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { editarPublicado } from '@/modules/plano-alimentar/publicacao';
import { quantidadeDoItem } from '@/modules/portal/plano';
import { CATEGORIAS_DA_IA_NUTRI } from '../campos-enviados';
import { provedorFake } from '../provedor-fake';
import { corpoDaConversa, montarContexto, relerTrechos } from './contexto';
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
    expect(await encaminhar(ctxP, saiu)).toBe('encaminhada'); // encaminhada DEPOIS de sair: continua no histórico
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
