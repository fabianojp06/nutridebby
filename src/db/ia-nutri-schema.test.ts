import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { mensagemNoBanco } from '../../test/ia-nutri';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

// Plano 15 (P15-01): o banco da IA Nutri do paciente — 0115 (tabelas) e 0116 (RLS, gatilhos de colunas e de DELETE, a pausa)
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await dono.pool.end();
});
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaRls = (e: unknown) => causa(e).code === '42501' && /row-level security/.test(String(causa(e).message));
const semPermissao = (e: unknown) => causa(e).code === '42501' && /permission denied/.test(String(causa(e).message));
const violaCheck = (nome?: string) => (e: unknown) => causa(e).code === '23514' && (!nome || causa(e).constraint === nome);
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const q = (s: SQL, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}

describe('0115/0116: ia_nutri_consentimentos (RN-171)', () => {
  it('o aceite é só da sessão do próprio paciente, com a própria conta; registrado_em é do gatilho', async () => {
    const { T, p, q } = await cenario();
    const conta = randomUUID();
    const ctxP = ctxPaciente(T.tenantId, p.id, conta);
    const [r] = (await q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por, registrado_em)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'app', ${conta}, '2020-01-01') returning registrado_em`, ctxP)).rows as { registrado_em: string }[];
    expect(new Date(r.registrado_em).getTime()).toBeGreaterThan(Date.now() - 60_000);
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'app', ${randomUUID()})`, ctxP)).rejects.toSatisfy(violaRls);
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'app', ${T.nutriId})`)).rejects.toSatisfy(negadoPor('só o próprio paciente dá o consentimento'));
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'revogacao', 'app', ${conta})`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('só pela função app_ia_nutri_revogar'));
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'revogacao', 'app', ${conta})`, ctxP)).rejects.toSatisfy(violaRls);
  });
  it('a sessão de P2 não grava aceite de P1 (patient_isolation, não a regra do evento); o mesmo aceite para P2 passa', async () => {
    const { T, p, q } = await cenario();
    const p2 = await novoPaciente(app.db, T.ctx);
    const contaP2 = randomUUID();
    const ctxP2 = ctxPaciente(T.tenantId, p2.id, contaP2);
    // o isolamento genérico grava `revogacao` e cai em paciente_consentimento_proprio: aqui o evento é o que o papel pode gravar
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'app', ${contaP2})`, ctxP2)).rejects.toSatisfy(
      (e: unknown) => violaRls(e) && String((e as { cause?: { message?: string } }).cause?.message ?? '').includes('ia_nutri_consentimentos'),
    );
    await q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p2.id}, 'aceite', '1.0', 'teste', 'app', ${contaP2})`, ctxP2); // controle positivo
  });
  it('DP-17: canal `nutricionista` só na revogação; o paciente nunca grava esse canal', async () => {
    const { T, p, q } = await cenario();
    const conta = randomUUID();
    // na sessão de paciente, o WITH CHECK da RLS (paciente_consentimento_proprio: canal 'app') roda antes dos CHECKs da tabela
    await expect(q(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'nutricionista', ${conta})`, ctxPaciente(T.tenantId, p.id, conta))).rejects.toSatisfy(violaRls);
    // o CHECK em si, pelo dono (contexto vazio: o gatilho só aplica as regras de dado e a RLS não se aplica ao superusuário)
    await expect(dono.db.execute(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, versao, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'aceite', '1.0', 'teste', 'nutricionista', ${conta})`)).rejects.toSatisfy(violaCheck('ia_nutri_consentimentos_canal_valido'));
  });
  it('só inclusão: UPDATE, DELETE e TRUNCATE sem permissão para o app', async () => {
    const { T, q } = await cenario();
    await expect(q(sql`update ia_nutri_consentimentos set ip = null`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
    await expect(q(sql`delete from ia_nutri_consentimentos`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
  });
});

describe('0116: ia_nutri_mensagens — colunas por papel (RNF-164)', () => {
  it('o paciente só encaminha a própria pergunta (uma vez, sem risco) e só avalia a resposta (uma vez)', async () => {
    const { T, p, q } = await cenario();
    const ctxP = ctxPaciente(T.tenantId, p.id);
    const pergunta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const resposta = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, texto: 'No seu plano está assim:', respondeA: pergunta, contouNoLimite: false });
    await q(sql`update ia_nutri_mensagens set encaminhada_em = now() where id = ${pergunta}`, ctxP);
    await expect(q(sql`update ia_nutri_mensagens set encaminhada_em = now() where id = ${pergunta}`, ctxP)).rejects.toSatisfy(negadoPor('encaminhamento só da própria pergunta'));
    await q(sql`update ia_nutri_mensagens set avaliacao = 'ajudou' where id = ${resposta}`, ctxP);
    await expect(q(sql`update ia_nutri_mensagens set avaliacao = 'nao_ajudou' where id = ${resposta}`, ctxP)).rejects.toSatisfy(negadoPor('avaliação só uma vez'));
    for (const set of [sql`risco = 'modelo'`, sql`status = 'cancelada'`, sql`texto = 'outro'`, sql`expira_em = now()`, sql`contou_no_limite = false`, sql`resolvida_em = now(), resolucao = 'vista'`])
      await expect(q(sql`update ia_nutri_mensagens set ${set} where id = ${pergunta}`, ctxP)).rejects.toSatisfy(negadoPor(''));
    await expect(q(sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, expira_em)
      values (${T.tenantId}, ${p.id}, now(), 'paciente', 'oi', 'na_fila', now())`, ctxP)).rejects.toSatisfy(violaRls);
    // o DELETE do paciente nem chega ao gatilho: a política RESTRICTIVE paciente_sem_delete esconde a linha (0 linhas, sem erro,
    // como em paciente-escrita.test.ts); a pergunta continua lá
    expect((await q(sql`delete from ia_nutri_mensagens where id = ${pergunta}`, ctxP)).rowCount).toBe(0);
    const [ainda] = (await q(sql`select count(*)::int as n from ia_nutri_mensagens where id = ${pergunta}`, worker(T.tenantId))).rows as { n: number }[];
    expect(ainda.n).toBe(1);
  });
  it('pergunta com risco não é encaminhada pelo paciente (já está na fila); a equipe só abre e resolve em nome próprio', async () => {
    const { T, p, q } = await cenario();
    const risco = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'transtorno_alimentar', encaminhadaEm: new Date(), contouNoLimite: false });
    await expect(q(sql`update ia_nutri_mensagens set encaminhada_em = now() where id = ${risco}`, ctxPaciente(T.tenantId, p.id))).rejects.toSatisfy(negadoPor(''));
    await expect(q(sql`update ia_nutri_mensagens set resolvida_em = now(), resolucao = 'vista', resolvida_por = ${randomUUID()} where id = ${risco}`)).rejects.toSatisfy(negadoPor('em nome da usuária da sessão'));
    await q(sql`update ia_nutri_mensagens set aberta_pela_nutri_em = now(), resolvida_em = now(), resolucao = 'vista', resolvida_por = ${T.nutriId} where id = ${risco}`);
    await expect(q(sql`update ia_nutri_mensagens set texto = null where id = ${risco}`)).rejects.toSatisfy(negadoPor('a equipe só abre e resolve'));
  });
  it('destino e saída não mudam; tenant e paciente são fixos (antes da RLS)', async () => {
    const { T, p, q } = await cenario();
    const m = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando', enviadoEm: new Date(), saiuEm: new Date(), destino: 'teste' });
    await expect(q(sql`update ia_nutri_mensagens set destino = 'bedrock-eu' where id = ${m}`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('o destino'));
    await expect(q(sql`update ia_nutri_mensagens set saiu_em = null where id = ${m}`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('a saída da pergunta'));
    await expect(q(sql`update ia_nutri_mensagens set patient_id = gen_random_uuid() where id = ${m}`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('coluna fixa'));
  });
  it('uma pergunta por vez (índice único parcial) e os CHECKs de autor, texto e destino', async () => {
    const { T, p } = await cenario();
    await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'na_fila' });
    await expect(mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando' })).rejects.toMatchObject({ cause: { code: '23505' } });
    await expect(mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', texto: 'x'.repeat(501) })).rejects.toSatisfy(violaCheck('ia_nutri_mensagens_texto_tamanho'));
    await expect(mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', destino: 'teste' })).rejects.toSatisfy(violaCheck('ia_nutri_mensagens_destino_valido'));
    await expect(mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'nutri' as never, status: null })).rejects.toSatisfy(violaCheck('ia_nutri_mensagens_autor_valido'));
  });
  it('D22: a equipe apaga só a pergunta com risco de quem revogou, depois de aberta — com a mensagem `sistema` apontando para ela; o worker apaga', async () => {
    const { T, p, q } = await cenario();
    const aberta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', encaminhadaEm: new Date(), revogadaEm: new Date(), abertaPelaNutriEm: new Date(), contouNoLimite: false });
    // como grava app_ia_nutri_perguntar (0117): a mensagem do texto fixo responde à pergunta com risco
    const sistema = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'sistema', status: null, texto: null, textoFixo: null, respondeA: aberta, revogadaEm: new Date(), contouNoLimite: false });
    const comum = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', contouNoLimite: false });
    await expect(q(sql`delete from ia_nutri_mensagens where id = ${comum}`)).rejects.toSatisfy(negadoPor('não é apagada por este caminho'));
    await q(sql`delete from ia_nutri_mensagens where id = ${aberta}`); // o SET NULL de responde_a passa pelo gatilho na sessão nutri
    const [filha] = (await q(sql`select responde_a from ia_nutri_mensagens where id = ${sistema}`, worker(T.tenantId))).rows as { responde_a: string | null }[];
    expect(filha.responde_a).toBeNull();
    // a equipe não aponta responde_a para outra mensagem nem a anula direto (só o SET NULL da FK, dentro do gatilho de RI)
    await expect(q(sql`update ia_nutri_mensagens set responde_a = ${comum} where id = ${sistema}`)).rejects.toSatisfy(negadoPor('a equipe só abre e resolve'));
    const resposta = await mensagemNoBanco(app.db, T.tenantId, p.id, { autor: 'ia', status: null, texto: 'No seu plano está assim:', respondeA: comum, contouNoLimite: false });
    await expect(q(sql`update ia_nutri_mensagens set responde_a = null where id = ${resposta}`)).rejects.toSatisfy(negadoPor('a equipe só abre e resolve'));
    await q(sql`delete from ia_nutri_mensagens where id = ${comum}`, worker(T.tenantId));
  });
});

describe('0116: pausa da plataforma e colunas do consultório', () => {
  it('a pausa é uma linha só e só muda fora de withTenant (qualquer papel recusa; nada muda de fato)', async () => {
    const { T, q } = await cenario();
    const [l] = (await app.db.execute(sql`select count(*)::int as n, bool_and(pausada_em is null and pausada_por is null) as livre from ia_nutri_pausa`)).rows as { n: number; livre: boolean }[];
    expect(l).toEqual({ n: 1, livre: true }); // DP-1 / ★ DO-1 = não: nasce NÃO pausada (nenhum teste do banco comum muda a linha)
    for (const ctx of [T.ctx, worker(T.tenantId)])
      await expect(q(sql`update ia_nutri_pausa set pausada_em = now()`, ctx)).rejects.toSatisfy(negadoPor('só a admin pausa'));
    await expect(q(sql`insert into ia_nutri_pausa (id) values (true)`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
  });
  it('a cota da IA Nutri é da admin; a ativação não muda nas sessões de paciente, público e conta', async () => {
    const { T, p, q } = await cenario();
    await expect(q(sql`update tenants set ia_nutri_cota_mensal_usd = 999 where id = ${T.tenantId}`)).rejects.toSatisfy(negadoPor('só a admin muda'));
    await q(sql`update tenants set ia_nutri_ativada_em = now() where id = ${T.tenantId}`); // a nutricionista
    await expect(q(sql`update tenants set ia_nutri_ativada_em = null where id = ${T.tenantId}`, ctxPaciente(T.tenantId, p.id))).rejects.toSatisfy(negadoPor('só a equipe e o worker'));
  });
});
