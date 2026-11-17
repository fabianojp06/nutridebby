import { sql } from 'drizzle-orm';
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
import { mensagemNoBanco, PAUSADA } from '../../../../test/ia-nutri';
import { novoPaciente, type TenantDeTeste } from '../../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { reservar } from '../cota';
import { RepetirIaError } from '../leitura-job';
import { MAX_TOKENS_CONVERSA } from '../precos';
import { ErroProvedor, type PedidoGeracao, type ProvedorIA, type RespostaGeracao } from '../provedor';
import { provedorFake, USO_FAKE, type ProvedorFake } from '../provedor-fake';
import { desativarNoApp } from './consentimento';
import { montarContexto } from './contexto';
import { perguntar } from './conversa';
import { PROMPT_VERSAO_CONVERSA, SISTEMA_CONVERSA } from './instrucoes';
import { processarPerguntaIaNutri } from './job';
import { apagarIaNutriDoTitular } from './lgpd';
import { bloquearPaciente, desativarIaNutri } from './participacao';
import { expirarPerguntasDoTenant } from './varredura';

// Plano 15 (P15-09): o job `ia-paciente` — reserva, contexto, portão do envio, uma chamada, validação, releitura e gravação
// (spec F3-02 v0.4 §4.2, RN-170, RN-172, RN-174, RN-175, RN-179, RN-180, D4 do Plano 11, DP-8, DP-9, Review Focus 1 e 2)
afterAll(fecharHarnessDaConversa);

const depsDe = depsDoJob;
/** Um provedor que faz algo no meio da chamada (depois do contexto e do portão, antes da releitura e do passo 6). */
const comEfeito = (fake: ProvedorFake, efeito: () => Promise<unknown>): ProvedorIA => ({
  ...fake,
  gerar: async (p) => {
    await efeito();
    return fake.gerar(p);
  },
});
const respostaDaIa = (T: TenantDeTeste, perguntaId: string) =>
  comoWorker(T, sql`select texto, texto_fixo, motivo_tecnico from ia_nutri_mensagens where responde_a = ${perguntaId}`);
const pergunta = async (T: TenantDeTeste, id: string) =>
  (await comoWorker(T, sql`select status, risco, motivo_tecnico, enviado_em, saiu_em, destino, reserva_micro_usd from ia_nutri_mensagens where id = ${id}`))[0];
const uso = async (T: TenantDeTeste, id: string) => (await comoWorker(T, sql`select situacao, tipo, recusa_categoria from ia_uso where tarefa_id = ${id}`))[0];
const jobsDeRisco = async (tenantId: string) => (await (await getBoss()).findJobs('ia-nutri-risco')).filter((j) => (j.data as { tenantId: string }).tenantId === tenantId);
/** O texto do único turno do usuário que saiu ao provedor. */
const textoQueSaiu = (p: PedidoGeracao): string => {
  const t = p.turnos[0];
  if (t.papel !== 'usuario' || t.blocos[0].tipo !== 'texto') throw new Error('turno inesperado');
  return t.blocos[0].texto;
};
const SUBSTITUICAO = { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] };
const BANANA = 'o que posso comer no lugar da banana à tarde?';

describe('processarPerguntaIaNutri (§4.2 do worker)', () => {
  it('substituição: resposta montada com o trecho relido, pergunta respondida, uso confirmado, "Pergunta enviada à IA" sem ator', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('respondida');
    const linhas = await comoWorker(T, sql`select autor, status, texto, texto_fixo, categoria, tipo_resposta, fontes, responde_a, modelo, prompt_versao from ia_nutri_mensagens where patient_id = ${p.id} order by created_at, autor desc`);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ autor: 'paciente', status: 'respondida' });
    expect(linhas[1]).toMatchObject({ autor: 'ia', categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'], responde_a: mensagemId, texto_fixo: null, modelo: 'claude-haiku-5-5', prompt_versao: PROMPT_VERSAO_CONVERSA });
    expect(linhas[1].texto).toMatch(/^No seu plano, as opções de substituição são:\nMaçã, Fuji, com casca, crua — .+\nFonte: Lanche da tarde — substituições\nIsto é o que está escrito no seu plano\./);
    expect(await pergunta(T, mensagemId!)).toMatchObject({ destino: 'teste', saiu_em: expect.any(String), enviado_em: expect.any(String) });
    expect(await uso(T, mensagemId!)).toMatchObject({ situacao: 'confirmado', tipo: 'conversa_paciente' });
    // a resposta na MESMA sessão e com a mesma guarda da pergunta, ao microssegundo (o Date do JS só tem milissegundos)
    const [mesma] = await comoWorker(T, sql`select r.sessao_inicio = q.sessao_inicio and r.expira_em = q.expira_em as igual from ia_nutri_mensagens r join ia_nutri_mensagens q on q.id = r.responde_a where q.id = ${mensagemId}`);
    expect(mesma).toEqual({ igual: true });
    const audit = await comoWorker(T, sql`select acao, actor_user_id from audit_log where entidade = 'ia_nutri' and entidade_id = ${mensagemId} and acao = 'exportar'`);
    expect(audit).toEqual([{ acao: 'exportar', actor_user_id: null }]);
    const ler = await comoWorker(T, sql`select count(*)::int as n from audit_log where patient_id = ${p.id} and entidade = 'plano_alimentar' and acao = 'ler'`);
    expect(ler[0].n).toBe(0); // auditar: false
    const pedido = fake.chamadas.gerar[0];
    expect(fake.chamadas.gerar).toHaveLength(1);
    expect(pedido).toMatchObject({ finalidade: 'conversa_paciente', modelo: 'claude-haiku-5-5', ferramentas: [], esforco: 'low', maxTokens: MAX_TOKENS_CONVERSA, prazoMs: 45_000, sistema: SISTEMA_CONVERSA });
  });

  it('DP-8: o turno enviado é EXATAMENTE o corpo do contexto, sem chave fora do contrato', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const c = (await montarContexto(app.db, { tenantId: T.tenantId, patientId: p.id, mensagemId: mensagemId! }))!;
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake));
    const turnos = fake.chamadas.gerar[0].turnos;
    expect(turnos).toEqual([{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: c.corpo }] }]);
    expect(textoQueSaiu(fake.chamadas.gerar[0])).toBe(c.corpo);
    const chaves = new Set<string>();
    const juntar = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(juntar);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          chaves.add(k);
          juntar(x);
        }
      }
    };
    juntar(JSON.parse(c.corpo.slice(c.corpo.indexOf('\n') + 1)));
    const permitidas = ['contexto', 'plano', 'orientacoes', 'indices', 'historico', 'pergunta', 'refeicoes', 'indice', 'nome', 'horario', 'observacao', 'itens', 'substituicoes', 'alimento', 'quantidade', 'kcal', 'substitui', 'texto', 'data', 'autor', 'tipo_resposta', 'fontes',
      // Plano 19 (RN-255, R-239): dias e hoje, kcal do dia, texto livre, listas ligadas (grupos) e o marcador de resumo
      'hoje', 'kcal_do_dia', 'dias', 'texto_livre', 'listas', 'grupos', 'orientacao', 'resumido'];
    expect([...chaves].filter((k) => !permitidas.includes(k))).toEqual([]);
  });

  it('Review Focus 1: plano republicado entre o contexto e a releitura → "Não encontrei…", nenhum trecho', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    // a publicação nova arquiva a versão que o contexto leu (a RLS do paciente ainda a vê): o job exige o MESMO id publicado
    const prov = comEfeito(fake, () => editarEPublicarDeNovo(T, p.id));
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('respondida');
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'nao_encontrei', motivo_tecnico: 'invalida_fonte' }]);
  });

  it('Review Focus 2: revogação com a pergunta processando → nada de resposta, pergunta cancelada, uso incerto', async () => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    const prov = comEfeito(fake, () => desativarNoApp(ctxP, depsApp));
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('falhou');
    expect(await respostaDaIa(T, mensagemId!)).toEqual([]); // nenhuma mensagem `ia`
    expect((await pergunta(T, mensagemId!)).status).toBe('cancelada');
    expect((await uso(T, mensagemId!)).situacao).toBe('incerto'); // o pedido saiu: a reserva fica como custo; o job ia-nutri-revogacao não estorna o que saiu
  });

  it.each([
    ['fonte inexistente', BANANA, { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S99'] }, 'nao_encontrei', 'invalida_fonte'],
    ['campo de texto livre', 'quanto de arroz no almoço?', { categoria: 'plano', tipo_resposta: 'quantidade', fontes: ['#I1'], resposta: 'pode' }, 'nao_encontrei', 'invalida_formato'],
    ['tipo incoerente com a fonte', 'quanto de arroz no almoço?', { categoria: 'plano', tipo_resposta: 'horario', fontes: ['#I1'] }, 'nao_encontrei', 'invalida_tipo'],
    ['suplemento fora do plano', 'quanto de creatina no almoço?', { categoria: 'plano', tipo_resposta: 'quantidade', fontes: ['#I1'] }, 'suplemento_ou_remedio', 'invalida_termo'],
    ['sintoma (posso X se tenho Y)', 'posso comer o almoço mesmo com diarreia?', { categoria: 'plano', tipo_resposta: 'quantidade', fontes: ['#I1'] }, 'sintoma_ou_exame', 'condicao'],
    ['categoria fora do plano', 'posso mudar o jantar?', { categoria: 'mudanca_plano', tipo_resposta: 'nenhum', fontes: [] }, 'mudanca_plano', null],
  ])('%s → texto fixo', async (_n, texto, json, textoFixo, motivo) => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, texto, depsApp);
    const fake = provedorFake({ gerar: [finalOk(json)] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('respondida');
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: textoFixo, motivo_tecnico: motivo }]);
    expect((await pergunta(T, mensagemId!)).status).toBe('respondida');
    expect((await uso(T, mensagemId!)).situacao).toBe('confirmado'); // o pedido saiu: o custo é acertado sempre
  });

  it('recusa do modelo → "Não encontrei…" (recusa); cortada → invalida_formato', async () => {
    const recusa: RespostaGeracao = { tipo: 'recusa', categoria: 'cyber', bruto: [], uso: USO_FAKE, requestId: 'fake-req' };
    const cortada: RespostaGeracao = { tipo: 'cortada', bruto: [], uso: USO_FAKE, requestId: 'fake-req' };
    for (const [r, motivo] of [[recusa, 'recusa'], [cortada, 'invalida_formato']] as const) {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(provedorFake({ gerar: [r] })))).toBe('respondida');
      expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'nao_encontrei', motivo_tecnico: motivo }]);
      expect(await uso(T, mensagemId!)).toMatchObject({ situacao: 'confirmado', recusa_categoria: r.tipo === 'recusa' ? 'cyber' : null });
    }
  });

  it('risco percebido pelo modelo → texto fixo de transtorno, pergunta com risco "modelo" na fila e o job ia-nutri-risco', async () => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp); // o filtro não pega: só o modelo
    expect(await jobsDeRisco(T.tenantId)).toEqual([]);
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] })] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('respondida');
    const [q] = await comoWorker(T, sql`select status, risco, encaminhada_em is not null as fila from ia_nutri_mensagens where id = ${mensagemId}`);
    expect(q).toEqual({ status: 'respondida', risco: 'modelo', fila: true });
    const [r] = await comoWorker(T, sql`select texto, texto_fixo, categoria, motivo_tecnico from ia_nutri_mensagens where responde_a = ${mensagemId}`);
    expect(r).toEqual({ texto: null, texto_fixo: 'risco_transtorno', categoria: 'risco', motivo_tecnico: null });
    expect((await jobsDeRisco(T.tenantId)).map((j) => j.data)).toEqual([{ tenantId: T.tenantId }]); // só o id do tenant
  });

  it('/code-review do PR #37: risco percebido pelo modelo com 10 já na fila de risco hoje → fora da fila, sem aviso, e o texto de emergência (nunca "Sua mensagem foi enviada ao consultório")', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'transtorno_alimentar', encaminhadaEm: new Date(), contouNoLimite: false });
    const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp);
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] })] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('respondida');
    const [q] = await comoWorker(T, sql`select status, risco, encaminhada_em is not null as fila from ia_nutri_mensagens where id = ${mensagemId}`);
    expect(q).toEqual({ status: 'respondida', risco: 'modelo', fila: false });
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'risco_emergencia', motivo_tecnico: null }]);
    expect(await jobsDeRisco(T.tenantId)).toEqual([]);
  });

  describe('/code-review do PR #37 (RN-109): a saída ao provedor só fica registrada quando pode ter havido', () => {
    const exportar = async (T: TenantDeTeste, id: string) =>
      (await comoWorker(T, sql`select count(*)::int as n from audit_log where entidade = 'ia_nutri' and acao = 'exportar' and entidade_id = ${id}`))[0].n;

    it('nao_enviado (nada saiu): sem saiu_em, destino nem "Pergunta enviada à IA"; a nova tentativa que sai grava uma vez', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [new ErroProvedor('nao_enviado', null, null), finalOk(SUBSTITUICAO)] });
      await expect(processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).rejects.toBeInstanceOf(RepetirIaError);
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'processando', enviado_em: null, saiu_em: null, destino: null });
      expect(await exportar(T, mensagemId!)).toBe(0);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('respondida');
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'respondida', saiu_em: expect.any(String), destino: 'teste' });
      expect(await exportar(T, mensagemId!)).toBe(1);
    });

    it('nao_enviado na última tentativa: falhou, estorno e nenhum registro de saída', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [new ErroProvedor('nao_enviado', null, null)] });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('falhou');
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'provedor_indisponivel', enviado_em: null, saiu_em: null, destino: null });
      expect(await exportar(T, mensagemId!)).toBe(0);
      expect((await uso(T, mensagemId!)).situacao).toBe('estornado');
      // recusa local do provedor (sem status, nada enviado) × recusa do servidor (400: o pedido chegou)
      for (const [erro, saiu] of [[new ErroProvedor('pedido_invalido', null, null), false], [new ErroProvedor('pedido_invalido', 400, 'r9'), true]] as const) {
        const outro = await pronto();
        const r = await perguntar(outro.ctxP, BANANA, depsApp);
        expect(await processarPerguntaIaNutri({ tenantId: outro.T.tenantId, mensagemId: r.mensagemId! }, depsDe(provedorFake({ gerar: [erro] })))).toBe('falhou');
        expect((await pergunta(outro.T, r.mensagemId!)).saiu_em === null, String(erro.status)).toBe(!saiu);
        expect(await exportar(outro.T, r.mensagemId!)).toBe(saiu ? 1 : 0);
      }
    });

    it('repetir (o pedido chegou ao provedor): saiu_em, destino e UM "Pergunta enviada à IA" — a nova tentativa não duplica nem reescreve', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'r1'), finalOk(SUBSTITUICAO)] });
      await expect(processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).rejects.toBeInstanceOf(RepetirIaError);
      const antes = await pergunta(T, mensagemId!);
      expect(antes).toMatchObject({ status: 'processando', enviado_em: null, saiu_em: expect.any(String), destino: 'teste' });
      expect(await exportar(T, mensagemId!)).toBe(1);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('respondida');
      expect((await pergunta(T, mensagemId!)).saiu_em).toEqual(antes.saiu_em); // a primeira saída
      expect(await exportar(T, mensagemId!)).toBe(1);
    });

    it('incerto, ou a nova tentativa que encontra enviado_em (o job caiu no meio da chamada): saiu_em = o envio, destino e "Pergunta enviada à IA"', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const incerto = provedorFake({ gerar: [new ErroProvedor('incerto', 500, 'r3')] });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(incerto))).toBe('falhou');
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', saiu_em: expect.any(String), destino: 'teste' });
      expect(await exportar(T, mensagemId!)).toBe(1);

      const outro = await pronto();
      const agora = new Date();
      const id = await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'processando', enviadoEm: agora, reservaMicroUsd: 5500 });
      await withTenant({ tenantId: outro.T.tenantId, role: 'worker' }, (tx) => reservar(tx, { tenantId: outro.T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: 5500, agora, tetoGlobalMicroUsd: 50_000_000_000 }), app.db);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      expect(await processarPerguntaIaNutri({ tenantId: outro.T.tenantId, mensagemId: id }, depsDe(fake))).toBe('falhou');
      expect(fake.chamadas.gerar).toHaveLength(0);
      const q = await pergunta(outro.T, id);
      expect(q).toMatchObject({ status: 'falhou', motivo_tecnico: 'resultado_incerto', destino: 'teste' });
      expect(q.saiu_em).toEqual(q.enviado_em);
      expect(await exportar(outro.T, id)).toBe(1);
    });

    it('re-revisão: a nova tentativa que encontra a pergunta já encerrada por fora (cancelada) com enviado_em registra a saída uma vez e ignora', async () => {
      const { T, p } = await pronto();
      const id = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'cancelada', enviadoEm: new Date(), reservaMicroUsd: 5500 });
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: id }, depsDe(fake))).toBe('ignorada');
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: id }, depsDe(fake))).toBe('ignorada');
      expect(fake.chamadas.gerar).toHaveLength(0);
      const q = await pergunta(T, id);
      expect(q).toMatchObject({ status: 'cancelada', destino: 'teste' });
      expect(q.saiu_em).toEqual(q.enviado_em);
      expect(await exportar(T, id)).toBe(1);
      // a cancelada que não saiu continua sem registro
      const naoSaiu = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'cancelada', reservaMicroUsd: 5500 });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: naoSaiu }, depsDe(fake))).toBe('ignorada');
      expect(await exportar(T, naoSaiu)).toBe(0);
    });

    it('re-revisão: a linha apagada no meio da chamada (exclusão com o titular bloqueado) deixa o "Pergunta enviada à IA" no audit_log', async () => {
      const { T, p, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const apagar = async () => {
        await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
        await comoWorker(T, sql`delete from ia_nutri_mensagens where patient_id = ${p.id}`);
      };
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(comEfeito(fake, apagar)))).toBe('falhou');
      expect(await comoWorker(T, sql`select id from ia_nutri_mensagens where id = ${mensagemId}`)).toEqual([]);
      expect(await exportar(T, mensagemId!)).toBe(1);
      expect((await uso(T, mensagemId!)).situacao).toBe('incerto');
    });

    it('re-revisão: a linha apagada no meio da chamada e o provedor falhando com o pedido enviado (repetir) também deixa UM "Pergunta enviada à IA"', async () => {
      const { T, p, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const apagar = async () => {
        await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
        await comoWorker(T, sql`delete from ia_nutri_mensagens where patient_id = ${p.id}`);
      };
      const fake = provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'r1')] });
      await expect(processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(comEfeito(fake, apagar)))).rejects.toBeInstanceOf(RepetirIaError);
      expect(await exportar(T, mensagemId!)).toBe(1);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('ignorada');
      expect(await exportar(T, mensagemId!)).toBe(1);
    });

    it('re-revisão: a exclusão atendida com a pergunta que saiu e o job caído registra a saída antes de apagar; a nova tentativa não duplica', async () => {
      const { T, p } = await pronto();
      const agora = new Date();
      const id = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando', enviadoEm: agora, reservaMicroUsd: 5500 });
      await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: 5500, agora, tetoGlobalMicroUsd: 50_000_000_000 }), app.db);
      await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
      await apagarIaNutriDoTitular({ tenantId: T.tenantId, role: 'worker' }, p.id, app.db);
      expect(await comoWorker(T, sql`select id from ia_nutri_mensagens where id = ${id}`)).toEqual([]);
      expect(await exportar(T, id)).toBe(1);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: id }, depsDe(provedorFake({ gerar: [finalOk(SUBSTITUICAO)] })))).toBe('ignorada');
      expect(await exportar(T, id)).toBe(1);
    });

    it('a varredura encerra a pergunta que saiu e não voltou (job caído): saiu_em, destino e "Pergunta enviada à IA"; a que não saiu, nada', async () => {
      const { T, p } = await pronto();
      const velha = new Date(Date.now() - 5 * 60_000);
      const envio = new Date(); // depois do aceite de pronto() (o portão só deixa sair com o aceite já gravado)
      const saiu = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando', enviadoEm: envio, createdAt: velha, reservaMicroUsd: 5500 });
      const outro = await pronto();
      const naoSaiu = await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'processando', createdAt: velha, reservaMicroUsd: 5500 });
      // encerrada pela função de perguntar (falhou/interrompida) com a reserva ainda pendente: a conciliação registra também
      const terceiro = await pronto();
      const pelaFuncao = await mensagemNoBanco(app.db, terceiro.T.tenantId, terceiro.p.id, { status: 'falhou', motivoTecnico: 'interrompida', enviadoEm: new Date(), createdAt: velha, reservaMicroUsd: 5500 });
      await withTenant({ tenantId: terceiro.T.tenantId, role: 'worker' }, (tx) => reservar(tx, { tenantId: terceiro.T.tenantId, tarefaId: pelaFuncao, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: 5500, agora: velha, tetoGlobalMicroUsd: 50_000_000_000 }), app.db);
      await expirarPerguntasDoTenant(app.db, T.tenantId, new Date());
      await expirarPerguntasDoTenant(app.db, outro.T.tenantId, new Date());
      await expirarPerguntasDoTenant(app.db, terceiro.T.tenantId, new Date());
      expect(await pergunta(terceiro.T, pelaFuncao)).toMatchObject({ status: 'falhou', saiu_em: expect.any(String), destino: 'teste' });
      expect(await exportar(terceiro.T, pelaFuncao)).toBe(1);
      expect((await uso(terceiro.T, pelaFuncao)).situacao).toBe('incerto');
      const q = await pergunta(T, saiu);
      expect(q).toMatchObject({ status: 'falhou', destino: 'teste' });
      expect(q.saiu_em).toEqual(q.enviado_em);
      expect(await exportar(T, saiu)).toBe(1);
      expect(await pergunta(outro.T, naoSaiu)).toMatchObject({ status: 'falhou', saiu_em: null, destino: null });
      expect(await exportar(outro.T, naoSaiu)).toBe(0);
    });
  });

  it('cota da IA Nutri esgotada → texto fixo indisponivel, pergunta falhou (cota), nada sai ao provedor', async () => {
    const { T, ctxP } = await pronto({ cotaUsd: 0 });
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('falhou');
    expect(fake.chamadas.gerar).toHaveLength(0);
    expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'cota', enviado_em: null, saiu_em: null });
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'indisponivel', motivo_tecnico: 'cota' }]);
    expect(await uso(T, mensagemId!)).toBeUndefined(); // nada reservado
  });

  it('erro antes do envio: repete uma vez (RepetirIaError) e, na última tentativa, falha com estorno; incerto: sem reenvio', async () => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [new ErroProvedor('nao_enviado', null, null), new ErroProvedor('repetir', 529, 'r2')] });
    await expect(processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).rejects.toBeInstanceOf(RepetirIaError);
    expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'processando', enviado_em: null }); // pronto para repetir
    expect((await uso(T, mensagemId!)).situacao).toBe('reservado');
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('falhou');
    expect(fake.chamadas.gerar).toHaveLength(2);
    expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'provedor_indisponivel' });
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'provedor_indisponivel' }]);
    expect((await uso(T, mensagemId!)).situacao).toBe('estornado');

    const outro = await pronto();
    const r = await perguntar(outro.ctxP, BANANA, depsApp);
    const incerto = provedorFake({ gerar: [new ErroProvedor('incerto', 500, 'r3')] });
    expect(await processarPerguntaIaNutri({ tenantId: outro.T.tenantId, mensagemId: r.mensagemId! }, depsDe(incerto))).toBe('falhou');
    expect(await pergunta(outro.T, r.mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'resultado_incerto', enviado_em: expect.any(String) });
    expect(await respostaDaIa(outro.T, r.mensagemId!)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'resultado_incerto' }]);
    expect((await uso(outro.T, r.mensagemId!)).situacao).toBe('incerto');
    // um job repetido depois disso não faz nada (a pergunta já terminou)
    expect(await processarPerguntaIaNutri({ tenantId: outro.T.tenantId, mensagemId: r.mensagemId! }, depsDe(incerto))).toBe('ignorada');
    expect(incerto.chamadas.gerar).toHaveLength(1);
  });

  it('nova tentativa que encontra enviado_em → resultado incerto, reserva mantida, sem chamar o provedor (D4 do Plano 11)', async () => {
    const { T, p } = await pronto();
    const agora = new Date();
    const id = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando', enviadoEm: agora, saiuEm: agora, destino: 'teste', reservaMicroUsd: 5500 });
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: 5500, agora, tetoGlobalMicroUsd: 50_000_000_000 }), app.db);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: id }, depsDe(fake))).toBe('falhou');
    expect(fake.chamadas.gerar).toHaveLength(0);
    expect(await pergunta(T, id)).toMatchObject({ status: 'falhou', motivo_tecnico: 'resultado_incerto' });
    expect(await respostaDaIa(T, id)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'resultado_incerto' }]);
    expect((await uso(T, id)).situacao).toBe('incerto');
  });

  describe('RN-170 reconferida no passo 1 e no passo 6, sem risco → cancelada sem resposta', () => {
    type Caso = Awaited<ReturnType<typeof pronto>>;
    const casos: [string, (c: Caso) => Promise<unknown>][] = [
      ['paciente bloqueado pela nutricionista', (c) => bloquearPaciente(c.T.ctx, c.p.id, app.db)],
      ['IA Nutri desativada no consultório', (c) => desativarIaNutri(c.T.ctx, { db: app.db })],
    ];
    it.each(casos)('%s antes do job: nada sai, nada reservado', async (_n, mudar) => {
      const c = await pronto();
      const { mensagemId } = await perguntar(c.ctxP, BANANA, depsApp);
      await mudar(c);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      expect(await processarPerguntaIaNutri({ tenantId: c.T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).toBe('falhou');
      expect(fake.chamadas.gerar).toHaveLength(0);
      expect(await pergunta(c.T, mensagemId!)).toMatchObject({ status: 'cancelada', enviado_em: null, saiu_em: null });
      expect(await respostaDaIa(c.T, mensagemId!)).toEqual([]);
      expect(await uso(c.T, mensagemId!)).toBeUndefined();
    });
    it.each(casos)('%s no meio da chamada: pergunta cancelada, nenhuma mensagem `ia`, uso incerto', async (_n, mudar) => {
      const c = await pronto();
      const { mensagemId } = await perguntar(c.ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      expect(await processarPerguntaIaNutri({ tenantId: c.T.tenantId, mensagemId: mensagemId! }, depsDe(comEfeito(fake, () => mudar(c))))).toBe('falhou');
      expect((await pergunta(c.T, mensagemId!)).status).toBe('cancelada');
      expect(await respostaDaIa(c.T, mensagemId!)).toEqual([]);
      expect((await uso(c.T, mensagemId!)).situacao).toBe('incerto');
    });
    it('pausa da plataforma antes do job e no meio da chamada (a pausa injetada é lida a cada conferência)', async () => {
      const a = await pronto();
      const ra = await perguntar(a.ctxP, BANANA, depsApp);
      const nada = provedorFake({ gerar: [] });
      expect(await processarPerguntaIaNutri({ tenantId: a.T.tenantId, mensagemId: ra.mensagemId! }, depsDe(nada, { pausa: PAUSADA }))).toBe('falhou');
      expect(nada.chamadas.gerar).toHaveLength(0);
      expect((await pergunta(a.T, ra.mensagemId!)).status).toBe('cancelada');

      const b = await pronto();
      const rb = await perguntar(b.ctxP, BANANA, depsApp);
      const pausa: { pausadaEm: Date | null } = { pausadaEm: null };
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      const prov = comEfeito(fake, async () => {
        pausa.pausadaEm = new Date();
      });
      expect(await processarPerguntaIaNutri({ tenantId: b.T.tenantId, mensagemId: rb.mensagemId! }, depsDe(prov, { pausa }))).toBe('falhou');
      expect((await pergunta(b.T, rb.mensagemId!)).status).toBe('cancelada');
      expect(await respostaDaIa(b.T, rb.mensagemId!)).toEqual([]);
      expect((await uso(b.T, rb.mensagemId!)).situacao).toBe('incerto');
    });
  });

  it('/code-review do PR #37: risco percebido pelo modelo com o paciente BLOQUEADO no meio da chamada → na fila (risco modelo), texto fixo de transtorno e o aviso', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp); // o filtro não pega: só o modelo
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] })] });
    const prov = comEfeito(fake, () => bloquearPaciente(T.ctx, p.id, app.db));
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('respondida');
    const [q] = await comoWorker(T, sql`select status, risco, encaminhada_em is not null as fila from ia_nutri_mensagens where id = ${mensagemId}`);
    expect(q).toEqual({ status: 'respondida', risco: 'modelo', fila: true });
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'risco_transtorno', motivo_tecnico: null }]);
    expect((await jobsDeRisco(T.tenantId)).length).toBeGreaterThan(0);
  });

  it('/code-review do PR #37: risco percebido pelo modelo depois da REVOGAÇÃO → só o aviso mínimo na fila (D22 b), sem texto e sem mensagem `ia`', async () => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp);
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] })] });
    const prov = comEfeito(fake, () => desativarNoApp(ctxP, depsApp));
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('falhou');
    // o que o seloDe da fila (T11) lê como `aviso_minimo`: risco, revogada, sem texto, encaminhada e não resolvida
    const [q] = await comoWorker(T, sql`select status, texto, risco, revogada_em is not null as rev, encaminhada_em is not null as fila, resolvida_em from ia_nutri_mensagens where id = ${mensagemId}`);
    expect(q).toEqual({ status: 'cancelada', texto: null, risco: 'modelo', rev: true, fila: true, resolvida_em: null });
    expect(await respostaDaIa(T, mensagemId!)).toEqual([]);
    expect((await uso(T, mensagemId!)).situacao).toBe('incerto');
    expect((await jobsDeRisco(T.tenantId)).length).toBeGreaterThan(0);
  });

  describe('Revisão da T9: a expiração de 3 min (varredura, app_ia_nutri_perguntar) × a chamada no ar', () => {
    const RISCO = { categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] };
    /** A volta da varredura 4 min depois (a pergunta já passou dos 3 min), com a chamada ainda no ar. */
    const varrerDaqui4Min = (T: TenantDeTeste) => expirarPerguntasDoTenant(app.db, T.tenantId, new Date(Date.now() + 4 * 60_000));

    it('fila atrasada: pergunta com mais de 2 min no portão → nada sai ao provedor, falhou (interrompida), "falha", reserva estornada', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      const daqui = new Date(Date.now() + 2 * 60_000 + 5_000);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { agora: () => daqui }))).toBe('falhou');
      expect(fake.chamadas.gerar).toHaveLength(0);
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'interrompida', enviado_em: null, saiu_em: null });
      expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'interrompida' }]);
      expect((await uso(T, mensagemId!)).situacao).toBe('estornado');
      const [{ n }] = await comoWorker(T, sql`select count(*)::int as n from audit_log where entidade = 'ia_nutri' and acao = 'exportar' and entidade_id = ${mensagemId}`);
      expect(n).toBe(0); // nada de "Pergunta enviada à IA"
    });

    it('com 1 min 50 s ainda passa pelo portão (o limite é 3 min − 45 s − 15 s de folga)', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      const daqui = new Date(Date.now() + 110_000);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { agora: () => daqui }))).toBe('respondida');
      expect(fake.chamadas.gerar).toHaveLength(1);
    });

    it('a varredura encerra a pergunta no meio da chamada e o modelo devolve RISCO → na fila (risco modelo), a "falha" vira o texto de transtorno e o aviso sai', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp); // o filtro não pega: só o modelo
      const fake = provedorFake({ gerar: [finalOk(RISCO)] });
      let varridas = 0;
      const prov = comEfeito(fake, async () => {
        varridas = await varrerDaqui4Min(T);
      });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('respondida');
      expect(varridas).toBe(1); // a varredura pegou a pergunta no ar
      const [q] = await comoWorker(T, sql`select status, motivo_tecnico, risco, encaminhada_em is not null as fila from ia_nutri_mensagens where id = ${mensagemId}`);
      expect(q).toEqual({ status: 'falhou', motivo_tecnico: 'interrompida', risco: 'modelo', fila: true });
      // uma resposta só: a de falha trocada pela de transtorno
      const respostas = await comoWorker(T, sql`select texto, texto_fixo, categoria, motivo_tecnico from ia_nutri_mensagens where responde_a = ${mensagemId}`);
      expect(respostas).toEqual([{ texto: null, texto_fixo: 'risco_transtorno', categoria: 'risco', motivo_tecnico: null }]);
      expect((await jobsDeRisco(T.tenantId)).map((j) => j.data)).toEqual([{ tenantId: T.tenantId }]);
      expect((await uso(T, mensagemId!)).situacao).toBe('incerto'); // a varredura já tinha dado o custo como incerto
    });

    it('outra execução do job (o pg-boss deu este por expirado) encerra a pergunta como resultado incerto no meio da chamada, com RISCO → o mesmo caminho', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp);
      const fake = provedorFake({ gerar: [finalOk(RISCO)] });
      const segunda = provedorFake({ gerar: [] });
      const prov = comEfeito(fake, () => processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(segunda)));
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('respondida');
      expect(segunda.chamadas.gerar).toHaveLength(0); // D4 do Plano 11: a segunda não reenviou
      const [q] = await comoWorker(T, sql`select status, motivo_tecnico, risco, encaminhada_em is not null as fila from ia_nutri_mensagens where id = ${mensagemId}`);
      expect(q).toEqual({ status: 'falhou', motivo_tecnico: 'resultado_incerto', risco: 'modelo', fila: true });
      expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'risco_transtorno', motivo_tecnico: null }]);
      expect((await jobsDeRisco(T.tenantId)).length).toBeGreaterThan(0);
    });

    it('a varredura no meio da chamada, SEM risco → segue a falha da varredura (uma mensagem "falha"), nada da resposta do modelo', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
      const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
      const prov = comEfeito(fake, () => varrerDaqui4Min(T));
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('falhou');
      expect(await pergunta(T, mensagemId!)).toMatchObject({ status: 'falhou', motivo_tecnico: 'interrompida', risco: null });
      expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'interrompida' }]);
      expect((await uso(T, mensagemId!)).situacao).toBe('incerto');
      expect(await jobsDeRisco(T.tenantId)).toEqual([]);
    });

    it('a varredura e depois a REVOGAÇÃO no meio da chamada, com risco → só o aviso mínimo na fila (D22 b), sem texto', async () => {
      const { T, ctxP } = await pronto();
      const { mensagemId } = await perguntar(ctxP, 'ando comendo bem pouco de propósito', depsApp);
      const fake = provedorFake({ gerar: [finalOk(RISCO)] });
      const prov = comEfeito(fake, async () => {
        await varrerDaqui4Min(T);
        await desativarNoApp(ctxP, depsApp);
      });
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(prov))).toBe('falhou');
      const [q] = await comoWorker(T, sql`select status, texto, risco, revogada_em is not null as rev, encaminhada_em is not null as fila, resolvida_em from ia_nutri_mensagens where id = ${mensagemId}`);
      expect(q).toEqual({ status: 'falhou', texto: null, risco: 'modelo', rev: true, fila: true, resolvida_em: null });
      // a mensagem `ia` de falha da varredura virou esqueleto na revogação, e nada volta para ela
      expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: null, motivo_tecnico: null }]);
      expect((await jobsDeRisco(T.tenantId)).length).toBeGreaterThan(0);
    });
  });

  it('máscara no que sai: nem o nome do paciente, nem o CPF da pergunta, nem o nome da nutricionista', async () => {
    const { T, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, 'sou a Ana Souza, CPF 123.456.789-09: a Debby disse que posso trocar a banana?', depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake));
    const pedido = fake.chamadas.gerar[0];
    const texto = textoQueSaiu(pedido);
    expect(texto).not.toMatch(/Ana|Souza|123\.456\.789-09|Debby/);
    expect(texto).toContain('[removido]');
  });

  it('3 perguntas processando no tenant → a 4ª relança (RepetirIaError); na última tentativa, "Não consegui responder agora…"', async () => {
    const { T, ctxP } = await pronto();
    for (let i = 0; i < 3; i++) await mensagemNoBanco(app.db, T.tenantId, (await novoPaciente(app.db, T.ctx)).id, { status: 'processando' });
    const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
    const fake = provedorFake({ gerar: [finalOk(SUBSTITUICAO)] });
    await expect(processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake))).rejects.toBeInstanceOf(RepetirIaError);
    expect((await pergunta(T, mensagemId!)).status).toBe('na_fila');
    expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDe(fake, { ultimaTentativa: true }))).toBe('falhou');
    expect(fake.chamadas.gerar).toHaveLength(0);
    expect(await respostaDaIa(T, mensagemId!)).toEqual([{ texto: null, texto_fixo: 'falha', motivo_tecnico: 'provedor_indisponivel' }]);
    expect(await uso(T, mensagemId!)).toBeUndefined();
  });

  it('DP-9 (/code-review do PR #37): dois jobs AO MESMO TEMPO com 2 já processando no tenant → só um passa do passo 1', async () => {
    const { T, ctxP } = await pronto();
    const outro = await outroPacientePronto(T); // mesmo tenant, liberado, com consentimento e o mesmo plano
    for (let i = 0; i < 2; i++) await mensagemNoBanco(app.db, T.tenantId, (await novoPaciente(app.db, T.ctx)).id, { status: 'processando' });
    const a = (await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp)).mensagemId!;
    const b = (await perguntar(outro.ctxP, 'quanto de arroz no almoço?', depsApp)).mensagemId!;
    // quem passa do passo 1 fica `processando`, parado dentro do `gerar` até o fim do teste
    let soltar!: () => void;
    const portao = new Promise<void>((r) => {
      soltar = r;
    });
    const fake = provedorFake({ gerar: [finalOk({ categoria: 'plano', tipo_resposta: 'quantidade', fontes: ['#I1'] })] });
    const prov = comEfeito(fake, () => portao);
    const ja = processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: a }, depsDe(prov));
    const jb = processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: b }, depsDe(prov));
    // sem a trava antes da contagem, os dois passariam e ficariam presos no portão: a corrida nunca terminaria (o teste cai no tempo)
    const primeiro = await Promise.race([ja.then(() => 'passou', (e: unknown) => e), jb.then(() => 'passou', (e: unknown) => e)]);
    expect(primeiro).toBeInstanceOf(RepetirIaError);
    soltar();
    const fins = await Promise.allSettled([ja, jb]);
    expect(fins.filter((f) => f.status === 'fulfilled').map((f) => (f as PromiseFulfilledResult<string>).value)).toEqual(['respondida']);
    expect(fake.chamadas.gerar).toHaveLength(1);
  });
});
