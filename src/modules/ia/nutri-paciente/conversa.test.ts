import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { IA_TESTE } from '../../../../test/ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, mensagemNoBanco, PAUSADA, SEM_PAUSA } from '../../../../test/ia-nutri';
import { ctxPaciente, novoTenant } from '../../../../test/pacientes';
import { planoPublicado } from '../../../../test/plano';
import { pacienteComConta } from '../../../../test/portal';
import { closeDb } from '@/db/client';
import { iaNutriMensagens, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { MSG_IA_NUTRI } from './constantes';
import { avaliar, conversaDoPaciente, encaminhar, enviarANutri, perguntar, situacoesDasPerguntas, type DepsIaNutri } from './conversa';

// Plano 15 (P15-08): a conversa no app — perguntar, enviar direto, avaliar, encaminhar, a projeção fechada e a situação
// (spec F3-02 v0.4 §4.2, §7.5, §13.1, US-172 a US-176, RN-174, RN-177 a RN-179, RN-183, DP-6, DP-16)
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // planoPublicado enfileira o PDF; perguntar enfileira os jobs
  await closeDb();
  await app.pool.end();
});

const deps: DepsIaNutri = { ia: IA_TESTE, appUrl: 'https://app.teste', db: app.db, pausa: SEM_PAUSA };

async function pronto() {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId);
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  const ctxP = ctxPaciente(T.tenantId, p.id, userId);
  await liberarNoBanco(app.db, T.ctx, p.id);
  await aceiteNoBanco(app.db, ctxP);
  await planoPublicado(app.db, T, p.id);
  return { T, p, ctxP };
}
const jobsIaPaciente = async (mensagemId: string | null) =>
  (await (await getBoss()).findJobs('ia-paciente')).filter((j) => (j.data as { mensagemId: string }).mensagemId === mensagemId);
const jobsDeRisco = async (tenantId: string) => (await (await getBoss()).findJobs('ia-nutri-risco')).filter((j) => (j.data as { tenantId: string }).tenantId === tenantId);
const mensagens = (T: { ctx: TenantContext }, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.patientId, patientId)), app.db);
const auditoria = (T: { ctx: TenantContext }, entidade: string, entidadeId: string | null) =>
  withTenant(T.ctx, (tx) => tx.execute(sql`select acao, entidade, actor_user_id from audit_log where entidade = ${entidade} and entidade_id = ${entidadeId}`), app.db);

describe('perguntar (US-172, RN-178, RN-179, RN-183)', () => {
  it('ok: a pergunta na fila, "Perguntou à IA" na auditoria e o job ia-paciente só com ids', async () => {
    const { T, p, ctxP } = await pronto();
    const r = await perguntar(ctxP, '  Quanto de arroz no almoço?  ', deps);
    expect(r).toMatchObject({ codigo: 'ok', textoFixo: null });
    expect((await jobsIaPaciente(r.mensagemId)).map((j) => j.data)).toEqual([{ tenantId: T.tenantId, mensagemId: r.mensagemId }]);
    const audit = await auditoria(T, 'ia_nutri_pergunta', r.mensagemId);
    expect(audit.rows).toEqual([{ acao: 'criar', entidade: 'ia_nutri_pergunta', actor_user_id: ctxP.actorUserId }]);
    const [m] = await mensagens(T, p.id);
    expect(m).toMatchObject({ id: r.mensagemId, autor: 'paciente', texto: 'Quanto de arroz no almoço?', status: 'na_fila', contouNoLimite: true });
    expect(await jobsDeRisco(T.tenantId)).toEqual([]);
  });

  it('uma por vez: a segunda enquanto a primeira está na fila → em_andamento, sem job nem auditoria nova', async () => {
    const { T, p, ctxP } = await pronto();
    expect((await perguntar(ctxP, 'Quanto de arroz?', deps)).codigo).toBe('ok');
    expect(await perguntar(ctxP, 'E de feijão?', deps)).toEqual({ codigo: 'em_andamento', mensagemId: null, textoFixo: null });
    expect(await mensagens(T, p.id)).toHaveLength(1);
  });

  it('sem plano publicado → sem_plano, nada gravado', async () => {
    const T = await novoTenant(app.db);
    await iaNutriPronta(app.db, T.tenantId);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    const ctxP = ctxPaciente(T.tenantId, p.id, userId);
    await liberarNoBanco(app.db, T.ctx, p.id);
    await aceiteNoBanco(app.db, ctxP);
    expect((await perguntar(ctxP, 'Quanto de arroz?', deps)).codigo).toBe('sem_plano');
    expect(await mensagens(T, p.id)).toHaveLength(0);
  });

  it('sinal de risco: o texto fixo na hora, sem job ia-paciente e com o job ia-nutri-risco (D10)', async () => {
    const { T, p, ctxP } = await pronto();
    const r = await perguntar(ctxP, 'depois do jantar eu vomito pra não engordar', deps);
    expect(r).toMatchObject({ codigo: 'risco', textoFixo: 'risco_transtorno' });
    expect(r.mensagemId).not.toBeNull();
    expect(await jobsIaPaciente(r.mensagemId)).toEqual([]);
    const risco = await jobsDeRisco(T.tenantId);
    expect(risco.map((j) => j.data)).toEqual([{ tenantId: T.tenantId }]); // só o id do tenant (regra 3)
    const ms = await mensagens(T, p.id);
    expect(ms.find((m) => m.id === r.mensagemId)).toMatchObject({ risco: 'transtorno_alimentar', status: 'respondida', contouNoLimite: false });
    expect(ms.find((m) => m.autor === 'sistema')).toMatchObject({ textoFixo: 'risco_transtorno', respondeA: r.mensagemId });
  });

  it('pausada, IA Nutri desativada ou IA_NUTRI_DESLIGADA → indisponivel e nada gravado', async () => {
    const { T, p, ctxP } = await pronto();
    expect(await perguntar(ctxP, 'oi', { ...deps, pausa: PAUSADA })).toEqual({ codigo: 'indisponivel', mensagemId: null, textoFixo: null });
    expect((await perguntar(ctxP, 'oi', { ...deps, ia: { ...IA_TESTE, nutriDesligada: true } })).codigo).toBe('indisponivel');
    expect((await perguntar(ctxP, 'oi', { ...deps, ia: { ...IA_TESTE, modo: 'ausente', destino: null, retencao: null } })).codigo).toBe('indisponivel');
    await app.db.update(tenants).set({ iaNutriAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect((await perguntar(ctxP, 'oi', deps)).codigo).toBe('indisponivel');
    expect(await mensagens(T, p.id)).toHaveLength(0);
  });

  it('a parte do paciente (sem consentimento) → indisponivel, nada gravado', async () => {
    const T = await novoTenant(app.db);
    await iaNutriPronta(app.db, T.tenantId);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    await liberarNoBanco(app.db, T.ctx, p.id);
    await planoPublicado(app.db, T, p.id);
    expect((await perguntar(ctxPaciente(T.tenantId, p.id, userId), 'Quanto de arroz?', deps)).codigo).toBe('indisponivel');
    expect(await mensagens(T, p.id)).toHaveLength(0);
  });

  it('sinal de risco com a IA Nutri indisponível entre a tela e o envio → o texto fixo de emergência mesmo assim, nada gravado', async () => {
    const { T, p, ctxP } = await pronto();
    expect(await perguntar(ctxP, 'quero sumir', { ...deps, pausa: PAUSADA })).toEqual({ codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' });
    expect(await mensagens(T, p.id)).toHaveLength(0);
    expect(await jobsDeRisco(T.tenantId)).toEqual([]);
  });

  it('transtorno alimentar sem nada gravado (indisponível, bloqueada ou acima do teto do dia) → o texto de emergência, nunca "Sua mensagem foi enviada ao consultório" (revisão final)', async () => {
    const { T, p, ctxP } = await pronto();
    const frase = 'depois do jantar eu vomito pra não engordar';
    const semEnvio = { codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' };
    expect(await perguntar(ctxP, frase, { ...deps, pausa: PAUSADA })).toEqual(semEnvio);
    expect(await enviarANutri(ctxP, frase, { ...deps, pausa: PAUSADA })).toEqual(semEnvio);
    expect(await perguntar(ctxP, frase, { ...deps, ia: { ...IA_TESTE, nutriDesligada: true } })).toEqual(semEnvio);
    expect(await mensagens(T, p.id)).toHaveLength(0);
    // gravada: o texto de transtorno (a mensagem foi mesmo ao consultório)
    expect(await perguntar(ctxP, frase, deps)).toMatchObject({ codigo: 'risco', textoFixo: 'risco_transtorno' });
    for (let i = 0; i < 49; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'transtorno_alimentar', contouNoLimite: false });
    expect(await perguntar(ctxP, frase, deps)).toEqual(semEnvio); // acima do teto do dia: nada gravado
    await withTenant(T.ctx, (tx) => tx.execute(sql`update ia_nutri_participacoes set bloqueada_em = now() where patient_id = ${p.id}`), app.db);
    expect(await perguntar(ctxP, frase, deps)).toEqual(semEnvio);
  });

  it('sinal de risco sem a parte do paciente (participação bloqueada) → o texto fixo mesmo assim, nada gravado', async () => {
    const { T, p, ctxP } = await pronto();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update ia_nutri_participacoes set bloqueada_em = now() where patient_id = ${p.id}`), app.db);
    expect(await perguntar(ctxP, 'quero sumir', deps)).toEqual({ codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' });
    expect(await mensagens(T, p.id)).toHaveLength(0);
  });

  it('"Perguntou à IA" também na pergunta com risco (a mensagem foi gravada); acima do teto do dia, sem auditoria nem job', async () => {
    const { T, p, ctxP } = await pronto();
    const r = await perguntar(ctxP, 'quero sumir', deps);
    expect(r).toMatchObject({ codigo: 'risco', textoFixo: 'risco_emergencia' });
    expect((await auditoria(T, 'ia_nutri_pergunta', r.mensagemId)).rows).toEqual([{ acao: 'criar', entidade: 'ia_nutri_pergunta', actor_user_id: ctxP.actorUserId }]);
    // LIMITE_RISCO_GRAVADO_DIA (50): as de hoje completam o teto; a seguinte mostra o texto, sem linha, auditoria nem job
    for (let i = 0; i < 49; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', contouNoLimite: false });
    const jobsAntes = (await jobsDeRisco(T.tenantId)).length;
    const acima = await perguntar(ctxP, 'quero sumir', deps);
    expect(acima).toEqual({ codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' });
    expect(await mensagens(T, p.id)).toHaveLength(51); // 1 pergunta + 1 aviso do sistema + 49
    expect((await jobsDeRisco(T.tenantId)).length).toBe(jobsAntes);
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from audit_log where entidade = 'ia_nutri_pergunta' and patient_id = ${p.id}`), app.db);
    expect(n.rows).toEqual([{ n: 1 }]);
  });

  it('vazia ou acima de 500 caracteres → IaNutriError(MSG_IA_NUTRI.longa), nada gravado', async () => {
    const { T, p, ctxP } = await pronto();
    await expect(perguntar(ctxP, 'x'.repeat(501), deps)).rejects.toThrow(MSG_IA_NUTRI.longa);
    await expect(perguntar(ctxP, '   ', deps)).rejects.toThrow(MSG_IA_NUTRI.longa);
    expect((await perguntar(ctxP, `  ${'x'.repeat(500)}  `, deps)).codigo).toBe('ok'); // o limite conta depois do trim
    expect(await mensagens(T, p.id)).toHaveLength(1);
  });

  it('fora da sessão de paciente com conta → erro (a nutricionista não pergunta pelo paciente)', async () => {
    const { T, p } = await pronto();
    await expect(perguntar(T.ctx, 'oi', deps)).rejects.toThrow(/sessão de paciente/);
    await expect(perguntar({ tenantId: T.tenantId, role: 'paciente', patientId: p.id }, 'oi', deps)).rejects.toThrow(/sessão de paciente/);
  });
});

describe('avaliar e encaminhar (US-172, US-174, RN-177)', () => {
  it('avalia a resposta uma vez; a segunda devolve false; resposta já esvaziada (sem texto) → false, sem erro', async () => {
    const { T, p, ctxP } = await pronto();
    const resposta = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…' });
    expect(await avaliar(ctxP, resposta, 'ajudou', app.db)).toBe(true);
    expect(await avaliar(ctxP, resposta, 'nao_ajudou', app.db)).toBe(false);
    const fixo = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: null, textoFixo: 'nao_encontrei' });
    expect(await avaliar(ctxP, fixo, 'nao_ajudou', app.db)).toBe(true);
    const esvaziada = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: null, textoFixo: null });
    expect(await avaliar(ctxP, esvaziada, 'ajudou', app.db)).toBe(false);
    const pergunta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    expect(await avaliar(ctxP, pergunta, 'ajudou', app.db)).toBe(false); // a pergunta não se avalia
    const ms = await mensagens(T, p.id);
    expect(Object.fromEntries(ms.map((m) => [m.id, m.avaliacao]))).toEqual({ [resposta]: 'ajudou', [fixo]: 'nao_ajudou', [esvaziada]: null, [pergunta]: null });
  });

  it('a resposta de outro paciente → false (a RLS esconde)', async () => {
    const a = await pronto();
    const b = await pronto();
    const resposta = await mensagemNoBanco(app.db, b.T.tenantId, b.p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…' });
    expect(await avaliar(a.ctxP, resposta, 'ajudou', app.db)).toBe(false);
    const pergunta = await mensagemNoBanco(app.db, b.T.tenantId, b.p.id, { status: 'respondida' });
    expect(await encaminhar(a.ctxP, pergunta, app.db)).toBe('nao_pode');
  });

  it('encaminha a própria pergunta respondida ou que falhou; com 3 dúvidas abertas (risco não conta) → limite; já encaminhada, na fila ou processando → nao_pode', async () => {
    const { T, p, ctxP } = await pronto();
    await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', encaminhadaEm: new Date(), contouNoLimite: false });
    const respondida = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const falhou = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'falhou' });
    const terceira = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const quarta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    expect(await encaminhar(ctxP, respondida, app.db)).toBe('encaminhada');
    expect(await encaminhar(ctxP, respondida, app.db)).toBe('nao_pode'); // já encaminhada
    expect(await encaminhar(ctxP, falhou, app.db)).toBe('encaminhada');
    expect(await encaminhar(ctxP, terceira, app.db)).toBe('encaminhada');
    expect(await encaminhar(ctxP, quarta, app.db)).toBe('limite');
    // resolvida pela nutricionista → abre vaga
    await withTenant(T.ctx, (tx) => tx.update(iaNutriMensagens).set({ resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'vista' }).where(eq(iaNutriMensagens.id, respondida)), app.db);
    expect(await encaminhar(ctxP, quarta, app.db)).toBe('encaminhada');

    const outro = await pronto();
    const naFila = await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'na_fila' });
    expect(await encaminhar(outro.ctxP, naFila, app.db)).toBe('nao_pode');
    await withTenant({ tenantId: outro.T.tenantId, role: 'worker' }, (tx) => tx.update(iaNutriMensagens).set({ status: 'processando' }).where(eq(iaNutriMensagens.id, naFila)), app.db);
    expect(await encaminhar(outro.ctxP, naFila, app.db)).toBe('nao_pode');
    const comRisco = await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'respondida', risco: 'transtorno_alimentar', contouNoLimite: false });
    expect(await encaminhar(outro.ctxP, comRisco, app.db)).toBe('nao_pode');
    const resposta = await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…' });
    expect(await encaminhar(outro.ctxP, resposta, app.db)).toBe('nao_pode'); // a resposta da IA não vai à fila: a pergunta vai
    const ms = await mensagens(outro.T, outro.p.id);
    expect(ms.every((m) => m.encaminhadaEm === null)).toBe(true);
  });

  it('encaminha a pergunta com resposta MONTADA (US-172 "Dúvida respondida pelo plano")', async () => {
    const { T, p, ctxP } = await pronto();
    const pergunta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano, no almoço: 4 colheres de arroz.', categoria: 'plano', tipoResposta: 'quantidade', respondeA: pergunta });
    expect(await encaminhar(ctxP, pergunta, app.db)).toBe('encaminhada');
    const [m] = (await mensagens(T, p.id)).filter((x) => x.id === pergunta);
    expect(m.encaminhadaEm).not.toBeNull();
  });

  it('/code-review do PR #37: id ou valor forjados no cliente → false / nao_pode, nunca erro do banco (22P02, 23514)', async () => {
    const { T, p, ctxP } = await pronto();
    const resposta = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…' });
    expect(await avaliar(ctxP, 'abc', 'ajudou', app.db)).toBe(false);
    expect(await avaliar(ctxP, resposta, 'otimo' as 'ajudou', app.db)).toBe(false);
    expect(await avaliar(ctxP, 42 as unknown as string, 'ajudou', app.db)).toBe(false);
    expect(await encaminhar(ctxP, 'abc', app.db)).toBe('nao_pode');
    expect(await encaminhar(ctxP, null as unknown as string, app.db)).toBe('nao_pode');
    expect(await avaliar(ctxP, resposta, 'ajudou', app.db)).toBe(true); // o caminho válido continua
  });
});

describe('enviarANutri (DP-16, §7.5)', () => {
  it('com o limite do dia atingido: encaminhada, sem job ia-paciente, "Enviou dúvida à nutricionista" na auditoria', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    expect((await perguntar(ctxP, 'mais uma', deps)).codigo).toBe('limite_dia');
    const r = await enviarANutri(ctxP, '  Posso trocar o jantar de dia?  ', deps);
    expect(r).toMatchObject({ codigo: 'encaminhada', textoFixo: null });
    expect(await jobsIaPaciente(r.mensagemId)).toEqual([]);
    expect((await auditoria(T, 'ia_nutri_duvida', r.mensagemId)).rows).toEqual([{ acao: 'criar', entidade: 'ia_nutri_duvida', actor_user_id: ctxP.actorUserId }]);
    const [m] = (await mensagens(T, p.id)).filter((x) => x.id === r.mensagemId);
    expect(m).toMatchObject({ texto: 'Posso trocar o jantar de dia?', status: 'respondida', contouNoLimite: false, risco: null });
    expect(m.encaminhadaEm).not.toBeNull();
  });

  it('com sinal de risco → o ramo de risco (texto fixo na hora, fila de risco), nunca a função de envio direto', async () => {
    const { T, ctxP } = await pronto();
    const r = await enviarANutri(ctxP, 'quero sumir', deps);
    expect(r).toMatchObject({ codigo: 'risco', textoFixo: 'risco_emergencia' });
    expect(await auditoria(T, 'ia_nutri_duvida', r.mensagemId)).toMatchObject({ rows: [] });
    expect((await auditoria(T, 'ia_nutri_pergunta', r.mensagemId)).rows).toHaveLength(1);
    expect(await jobsDeRisco(T.tenantId)).toHaveLength(1);
    // indisponível entre a tela e o envio: o texto fixo mesmo assim
    expect(await enviarANutri(ctxP, 'quero sumir', { ...deps, pausa: PAUSADA })).toEqual({ codigo: 'risco', mensagemId: null, textoFixo: 'risco_emergencia' });
  });

  it('pausada → indisponivel; 3 abertas → limite; vazia ou longa → IaNutriError', async () => {
    const { T, p, ctxP } = await pronto();
    expect(await enviarANutri(ctxP, 'Posso trocar?', { ...deps, pausa: PAUSADA })).toEqual({ codigo: 'indisponivel', mensagemId: null, textoFixo: null });
    for (let i = 0; i < 3; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', encaminhadaEm: new Date(), contouNoLimite: false });
    expect(await enviarANutri(ctxP, 'Posso trocar?', deps)).toEqual({ codigo: 'limite', mensagemId: null, textoFixo: null });
    await expect(enviarANutri(ctxP, ' ', deps)).rejects.toThrow(MSG_IA_NUTRI.longa);
    await expect(enviarANutri(ctxP, 'x'.repeat(501), deps)).rejects.toThrow(MSG_IA_NUTRI.longa);
    expect(await mensagens(T, p.id)).toHaveLength(3);
  });
});

describe('conversaDoPaciente (projeção fechada, RN-183)', () => {
  it('só as chaves da projeção, só as do próprio paciente, na ordem; leitura auditada como titular', async () => {
    const { T, p, ctxP } = await pronto();
    await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', fontes: ['#I1'], motivoTecnico: 'invalida_fonte', modelo: 'claude-haiku-5-5', promptVersao: 'x', reservaMicroUsd: 5 });
    const outro = await pronto(); // outro paciente de outro tenant
    await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'respondida' });
    const c = await conversaDoPaciente(ctxP, app.db);
    expect(c).toHaveLength(1);
    expect(Object.keys(c[0]).sort()).toEqual(['autor', 'avaliacao', 'criadaEm', 'duvida', 'id', 'podeEncaminhar', 'risco', 'rotuloCategoria', 'status', 'texto', 'textoFixo']);
    expect(c[0].risco).toBe(false); // boolean, nunca o grupo do risco
    expect(c[0].podeEncaminhar).toBe(true);
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao, actor_user_id from audit_log where entidade = 'ia_nutri' and acao = 'ler' and patient_id = ${p.id}`), app.db);
    expect(audit.rows).toEqual([{ acao: 'ler', actor_user_id: ctxP.actorUserId }]);
  });

  it('a pergunta, a resposta e o aviso do sistema na ordem; risco como booleano; dúvida aberta, vista e encerrada; rótulo da categoria', async () => {
    const { T, p, ctxP } = await pronto();
    const t = (s: number) => new Date(Date.now() - 600_000 + s * 1000);
    const pergunta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', createdAt: t(1) });
    await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…', categoria: 'plano', tipoResposta: 'quantidade', respondeA: pergunta, createdAt: t(2) });
    const vista = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', encaminhadaEm: t(3), createdAt: t(3) });
    const fixa = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: null, textoFixo: 'mudanca_plano', categoria: 'mudanca_plano', respondeA: vista, createdAt: t(4) });
    const encerrada = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'falhou', encaminhadaEm: t(5), createdAt: t(5) });
    const aberta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', encaminhadaEm: t(6), createdAt: t(6) });
    await withTenant(T.ctx, async (tx) => {
      await tx.update(iaNutriMensagens).set({ resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'vista' }).where(eq(iaNutriMensagens.id, vista));
      await tx.update(iaNutriMensagens).set({ resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'encerrada' }).where(eq(iaNutriMensagens.id, encerrada));
    }, app.db);
    const risco = await perguntar(ctxP, 'quero sumir', deps); // pergunta + aviso do sistema no mesmo instante
    const c = await conversaDoPaciente(ctxP, app.db);
    expect(c.map((m) => [m.autor, m.duvida, m.podeEncaminhar, m.risco, m.rotuloCategoria])).toEqual([
      ['paciente', null, true, false, null],
      ['ia', null, false, false, 'Dúvida sobre o plano'],
      ['paciente', 'vista', false, false, null],
      ['ia', null, false, false, 'Pedido de mudança no plano'],
      ['paciente', 'encerrada', false, false, null],
      ['paciente', 'aberta', false, false, null],
      ['paciente', 'aberta', false, true, null], // a com risco vai à fila de risco (encaminhada pela função)
      ['sistema', null, false, false, null],
    ]);
    expect(c.find((m) => m.id === fixa)).toMatchObject({ textoFixo: 'mudanca_plano', texto: null });
    expect(c.find((m) => m.id === aberta)).toMatchObject({ status: 'respondida' });
    expect(c.at(-1)).toMatchObject({ autor: 'sistema', textoFixo: 'risco_emergencia' });
    expect(c.at(-2)?.id).toBe(risco.mensagemId);
    expect(JSON.stringify(c)).not.toMatch(/"emergencia"|"transtorno_alimentar"|"modelo"|invalida_|claude-|#I1/);
  });

  it('fora da sessão de paciente → erro', async () => {
    const { T } = await pronto();
    await expect(conversaDoPaciente(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});

describe('situacoesDasPerguntas (RNF-160)', () => {
  it('só id e status das 5 últimas perguntas do próprio paciente, sem auditoria', async () => {
    const { T, p, ctxP } = await pronto();
    const t = (s: number) => new Date(Date.now() - 600_000 + s * 1000);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await mensagemNoBanco(app.db, T.tenantId, p.id, { status: i === 5 ? 'processando' : 'respondida', createdAt: t(i) }));
    await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, contouNoLimite: false, texto: 'No seu plano…', createdAt: t(7) });
    const outro = await pronto();
    await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'processando' });
    const s = await situacoesDasPerguntas(ctxP, app.db);
    expect(s).toEqual([
      { id: ids[5], status: 'processando' },
      ...[4, 3, 2, 1].map((i) => ({ id: ids[i], status: 'respondida' })),
    ]);
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade like 'ia_nutri%' and acao = 'ler' and patient_id = ${p.id}`), app.db);
    expect(audit.rows).toEqual([]);
  });
});

// a sessão da nutricionista lê a conversa pela ficha e pela fila (T11), nunca por estas funções
describe('nenhuma escrita da conversa fora da sessão do paciente', () => {
  it('avaliar, encaminhar, enviarANutri e situacoesDasPerguntas recusam a sessão nutri', async () => {
    const { T, p } = await pronto();
    const m = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    await expect(avaliar(T.ctx, m, 'ajudou', app.db)).rejects.toThrow(/sessão de paciente/);
    await expect(encaminhar(T.ctx, m, app.db)).rejects.toThrow(/sessão de paciente/);
    await expect(enviarANutri(T.ctx, 'oi', deps)).rejects.toThrow(/sessão de paciente/);
    await expect(situacoesDasPerguntas(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(iaNutriMensagens).where(and(eq(iaNutriMensagens.id, m))), app.db);
    expect(linhas[0].encaminhadaEm).toBeNull();
  });
});
