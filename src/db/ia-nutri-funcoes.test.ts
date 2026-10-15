import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, mensagemNoBanco } from '../../test/ia-nutri';
import { ctxPaciente, novoTenant } from '../../test/pacientes';
import { planoPublicado } from '../../test/plano';
import { pacienteComConta } from '../../test/portal';
import { closeDb } from './client';
import { withTenant, type TenantContext } from './tenant';
import { stopBoss } from '@/jobs/boss';

// Plano 15 (P15-02): as funções fechadas da 0117 — perguntar, enviar à nutricionista, revogar, anonimizar o consentimento
// e as métricas do admin (spec F3-02 v0.4 §4.2, RN-178, RN-179, RN-182, §13.3, D22, D32, DP-11, DP-16, DP-17)
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // planoPublicado enfileira o PDF
  await closeDb();
  await app.pool.end();
});
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaRls = (e: unknown) => causa(e).code === '42501' && /row-level security/.test(String(causa(e).message));
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

const perguntar = (ctxP: TenantContext, texto: string, o: { risco?: string; textoFixo?: string; versaoMin?: string; destino?: string } = {}) =>
  withTenant(ctxP, async (tx) => {
    const r = await tx.execute(sql`select * from app_ia_nutri_perguntar(${texto}, ${o.risco ?? null}, ${o.textoFixo ?? null}, ${o.versaoMin ?? '1.0'}, ${o.destino ?? 'teste'})`);
    const papel = await tx.execute(sql`select current_setting('app.role', true) as r, current_setting('app.patient_id', true) as p`);
    return { ...(r.rows[0] as { codigo: string; mensagem_id: string | null }), papel: papel.rows[0] as { r: string; p: string } };
  }, app.db);

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

describe('0117: as funções fechadas', () => {
  it('EXECUTE revogado de PUBLIC e concedido ao role da aplicação; search_path fixo; SECURITY DEFINER só nas que gravam ou contam', async () => {
    const { rows } = await app.pool.query<{ proname: string; publico: boolean; app: boolean; definer: boolean; config: string[] | null }>(`
      select p.proname,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
             has_function_privilege('nutri_app_role', p.oid, 'EXECUTE') as app,
             p.prosecdef as definer, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('app_versao_atende', 'app_ia_nutri_perguntar', 'app_ia_nutri_enviar_a_nutri', 'app_ia_nutri_revogar',
             'app_anonimizar_consentimentos_ia_nutri', 'admin_metricas_ia_nutri')
       order by p.proname`);
    expect(rows.map((r) => [r.proname, r.publico, r.app, r.definer, r.config])).toEqual([
      ['admin_metricas_ia_nutri', false, true, true, ['search_path=public, pg_temp']],
      ['app_anonimizar_consentimentos_ia_nutri', false, true, true, ['search_path=public, pg_temp']],
      ['app_ia_nutri_enviar_a_nutri', false, true, true, ['search_path=public, pg_temp']],
      ['app_ia_nutri_perguntar', false, true, true, ['search_path=public, pg_temp']],
      ['app_ia_nutri_revogar', false, true, true, ['search_path=public, pg_temp']],
      ['app_versao_atende', false, true, false, ['search_path=public, pg_temp']],
    ]);
  });
});

describe('0117: app_versao_atende (o versaoAtende de textos-legais.ts em SQL)', () => {
  it('compara a parte numérica campo a campo (falta = 0); fora do formato não atende', async () => {
    const casos: [string | null, string | null, boolean][] = [
      ['1.0', '1.0', true],
      ['1.2', '1.1', true],
      ['1.0', '1.1', false],
      ['1.10', '1.9', true],
      ['2', '1.9', true],
      ['1', '1.0', true],
      ['1.0', '1', true],
      ['1.0-provisorio', '1.0', true],
      ['0.1-provisorio', '1.0', false],
      ['v1.0', '1.0', false],
      [null, '1.0', false],
      ['1.0', null, false],
      ['1.99999999999999999999', '1.2', true], // campo maior que int: compara, não estoura
      ['1.0', '99999999999999999999', false],
    ];
    for (const [v, m, esperado] of casos) {
      const [r] = (await app.db.execute(sql`select app_versao_atende(${v}, ${m}) as ok`)).rows as { ok: boolean }[];
      expect([v, m, r.ok]).toEqual([v, m, esperado]);
    }
  });
});

describe('0117: app_ia_nutri_perguntar (RN-178, RN-179)', () => {
  it('grava a pergunta na fila, conta no limite e devolve o papel paciente (com o paciente) depois', async () => {
    const { T, p, ctxP } = await pronto();
    const r = await perguntar(ctxP, 'Quanto de arroz no almoço?');
    expect(r.codigo).toBe('ok');
    expect(r.papel).toEqual({ r: 'paciente', p: p.id });
    const [m] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select status, contou_no_limite, autor from ia_nutri_mensagens where id = ${r.mensagem_id}`), app.db)).rows;
    expect(m).toEqual({ status: 'na_fila', contou_no_limite: true, autor: 'paciente' });
  });
  it('o papel volta também quando a função devolve cedo (indisponível, sem plano, em andamento)', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    const r = await perguntar(ctxPaciente(T.tenantId, p.id, userId), 'oi');
    expect(r).toMatchObject({ codigo: 'indisponivel', mensagem_id: null, papel: { r: 'paciente', p: p.id } });
    const { p: p2, ctxP } = await pronto();
    expect(await perguntar(ctxP, 'primeira')).toMatchObject({ codigo: 'ok', papel: { r: 'paciente', p: p2.id } });
    expect(await perguntar(ctxP, 'segunda')).toMatchObject({ codigo: 'em_andamento', mensagem_id: null, papel: { r: 'paciente', p: p2.id } });
  });
  it('indisponível sem liberação, bloqueado, sem consentimento, versão abaixo do mínimo ou outro destino; sem plano → sem_plano', async () => {
    const { T, p, ctxP } = await pronto();
    expect((await perguntar(ctxP, 'oi', { versaoMin: '1.1' })).codigo).toBe('indisponivel');
    expect((await perguntar(ctxP, 'oi', { destino: 'anthropic-us' })).codigo).toBe('indisponivel');
    await withTenant(T.ctx, (tx) => tx.execute(sql`update ia_nutri_participacoes set bloqueada_em = now() where patient_id = ${p.id}`), app.db);
    expect((await perguntar(ctxP, 'oi')).codigo).toBe('indisponivel');
    const sem = await pronto();
    await withTenant(sem.T.ctx, (tx) => tx.execute(sql`update meal_plans set status = 'arquivado' where patient_id = ${sem.p.id}`), app.db);
    expect((await perguntar(sem.ctxP, 'oi')).codigo).toBe('sem_plano');
    // sem consentimento (nunca aceitou) e paciente arquivado
    const T3 = await novoTenant(app.db);
    await iaNutriPronta(app.db, T3.tenantId);
    const { paciente: p3, userId } = await pacienteComConta(app.db, T3);
    await liberarNoBanco(app.db, T3.ctx, p3.id);
    await planoPublicado(app.db, T3, p3.id);
    const ctx3 = ctxPaciente(T3.tenantId, p3.id, userId);
    expect((await perguntar(ctx3, 'oi')).codigo).toBe('indisponivel');
    await aceiteNoBanco(app.db, ctx3);
    expect((await perguntar(ctx3, 'oi')).codigo).toBe('ok');
    const arq = await pronto();
    await withTenant(arq.T.ctx, (tx) => tx.execute(sql`update patients set status = 'arquivado' where id = ${arq.p.id}`), app.db);
    expect((await perguntar(arq.ctxP, 'oi')).codigo).toBe('indisponivel');
  });
  it('cinco chamadas simultâneas: 1 ok e 4 em_andamento, uma linha só', async () => {
    const { T, p, ctxP } = await pronto();
    const r = await Promise.all(Array.from({ length: 5 }, () => perguntar(ctxP, 'Quanto de arroz?')));
    expect(r.map((x) => x.codigo).sort()).toEqual(['em_andamento', 'em_andamento', 'em_andamento', 'em_andamento', 'ok']);
    expect(r.every((x) => x.papel.r === 'paciente' && x.papel.p === p.id)).toBe(true);
    const [{ n }] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select count(*)::int as n from ia_nutri_mensagens where patient_id = ${p.id}`), app.db)).rows as { n: number }[];
    expect(n).toBe(1);
  });
  it('a pergunta presa há mais de 3 min vira falhou (interrompida), ganha a resposta de texto fixo "falha" e a nova entra', async () => {
    const { T, p, ctxP } = await pronto();
    const presa = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'processando', createdAt: new Date(Date.now() - 4 * 60_000) });
    expect((await perguntar(ctxP, 'De novo')).codigo).toBe('ok');
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select autor, status, texto_fixo, motivo_tecnico, responde_a from ia_nutri_mensagens where patient_id = ${p.id} order by created_at, autor`), app.db)).rows;
    // /code-review do PR #37: a mesma resposta que a varredura grava (a varredura não volta a uma pergunta já `falhou`)
    expect(linhas).toEqual([
      { autor: 'paciente', status: 'falhou', texto_fixo: null, motivo_tecnico: 'interrompida', responde_a: null },
      { autor: 'ia', status: null, texto_fixo: 'falha', motivo_tecnico: 'interrompida', responde_a: presa },
      { autor: 'paciente', status: 'na_fila', texto_fixo: null, motivo_tecnico: null, responde_a: null },
    ]);
  });
  it('a pergunta na fila há menos de 3 min continua em andamento (não vira falhou)', async () => {
    const { T, p, ctxP } = await pronto();
    const recente = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'na_fila', createdAt: new Date(Date.now() - 2 * 60_000) });
    expect((await perguntar(ctxP, 'De novo')).codigo).toBe('em_andamento');
    const [m] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select status from ia_nutri_mensagens where id = ${recente}`), app.db)).rows;
    expect(m).toEqual({ status: 'na_fila' });
  });
  it('limite do dia (10) e do mês (100): conta só contou_no_limite; risco não conta e não chama o modelo', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    expect((await perguntar(ctxP, 'mais uma')).codigo).toBe('limite_dia');
    const r = await perguntar(ctxP, 'quero sumir', { risco: 'emergencia', textoFixo: 'risco_emergencia' });
    expect(r.codigo).toBe('risco');
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select autor, status, risco, texto_fixo, contou_no_limite, encaminhada_em is not null as fila from ia_nutri_mensagens where patient_id = ${p.id} and (risco is not null or autor = 'sistema') order by created_at, autor`), app.db)).rows;
    expect(linhas).toEqual([
      { autor: 'paciente', status: 'respondida', risco: 'emergencia', texto_fixo: null, contou_no_limite: false, fila: true },
      { autor: 'sistema', status: null, risco: null, texto_fixo: 'risco_emergencia', contou_no_limite: false, fila: false },
    ]);
  });
  it('limite do mês (100), contado desde o início do mês no fuso do consultório; o que não contou no limite fica de fora', async () => {
    const { T, p, ctxP } = await pronto();
    // 100 no mês, em dias anteriores (nenhuma hoje): o limite do dia passa, o do mês não
    const ontem = await withTenant(worker(T.tenantId), async (tx) => {
      const [r] = (await tx.execute(sql`select (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 second' as ontem,
        date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as inicio`)).rows as { ontem: string; inicio: string }[];
      return r;
    }, app.db);
    const dentroDoMes = new Date(ontem.ontem) >= new Date(ontem.inicio);
    if (dentroDoMes) {
      await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, contou_no_limite, expira_em, created_at)
        select ${T.tenantId}, ${p.id}, ${ontem.ontem}::timestamptz, 'paciente', 'antiga', 'respondida', true, now() + interval '180 days', ${ontem.ontem}::timestamptz from generate_series(1, 100)`), app.db);
      expect((await perguntar(ctxP, 'mais uma')).codigo).toBe('limite_mes');
    } else {
      // dia 1º do mês: as de ontem são do mês anterior e não contam
      await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, contou_no_limite, expira_em, created_at)
        select ${T.tenantId}, ${p.id}, ${ontem.ontem}::timestamptz, 'paciente', 'antiga', 'respondida', true, now() + interval '180 days', ${ontem.ontem}::timestamptz from generate_series(1, 100)`), app.db);
      expect((await perguntar(ctxP, 'mais uma')).codigo).toBe('ok');
    }
    // as que não contaram no limite (risco, enviadas direto) não entram na conta do dia
    const outro = await pronto();
    for (let i = 0; i < 12; i++) await mensagemNoBanco(app.db, outro.T.tenantId, outro.p.id, { status: 'respondida', contouNoLimite: false });
    expect((await perguntar(outro.ctxP, 'mais uma')).codigo).toBe('ok');
  });
  it('a 11ª mensagem de risco do dia mostra o texto fixo mas não abre item na fila (RN-178)', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) expect((await perguntar(ctxP, `risco ${i}`, { risco: 'transtorno_alimentar', textoFixo: 'risco_transtorno' })).codigo).toBe('risco');
    const r = await perguntar(ctxP, 'risco 11', { risco: 'transtorno_alimentar', textoFixo: 'risco_transtorno' });
    expect(r.codigo).toBe('risco');
    expect(r.mensagem_id).not.toBeNull();
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select id, encaminhada_em is not null as fila from ia_nutri_mensagens where patient_id = ${p.id} and autor = 'paciente' order by created_at`), app.db)).rows as { id: string; fila: boolean }[];
    expect(linhas).toHaveLength(11);
    expect(linhas.slice(0, 10).every((l) => l.fila)).toBe(true);
    expect(linhas[10]).toEqual({ id: r.mensagem_id, fila: false });
    // a 11ª também ganha a mensagem `sistema`, mas com o texto de EMERGÊNCIA: fora da fila, nada foi ao consultório, e o de
    // transtorno diz "Sua mensagem foi enviada ao consultório" (/code-review do PR #37)
    const fixos = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select responde_a, texto_fixo from ia_nutri_mensagens where patient_id = ${p.id} and autor = 'sistema'`), app.db)).rows as { responde_a: string; texto_fixo: string }[];
    expect(fixos).toHaveLength(11);
    expect(fixos.filter((f) => f.texto_fixo === 'risco_transtorno').map((f) => f.responde_a).sort()).toEqual(linhas.slice(0, 10).map((l) => l.id).sort());
    expect(fixos.find((f) => f.responde_a === r.mensagem_id)?.texto_fixo).toBe('risco_emergencia');
  });
  it('acima de 50 mensagens de risco no dia: "risco" com o texto fixo, mas nada gravado (mensagem_id nulo)', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 50; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', contouNoLimite: false });
    expect(await perguntar(ctxP, 'quero sumir', { risco: 'emergencia', textoFixo: 'risco_emergencia' })).toMatchObject({ codigo: 'risco', mensagem_id: null });
    const [{ n }] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select count(*)::int as n from ia_nutri_mensagens where patient_id = ${p.id}`), app.db)).rows as { n: number }[];
    expect(n).toBe(50);
  });
  it('fora da sessão de paciente com conta → 42501; texto fora de 1–500 e par risco × texto fixo inválido → 22023', async () => {
    const { T, p, ctxP } = await pronto();
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from app_ia_nutri_perguntar('oi', null, null, '1.0', 'teste')`), app.db)).rejects.toSatisfy(negadoPor('só roda na sessão de paciente'));
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select * from app_ia_nutri_perguntar('oi', null, null, '1.0', 'teste')`), app.db)).rejects.toSatisfy(negadoPor('só roda na sessão de paciente'));
    await expect(withTenant({ tenantId: T.tenantId, role: 'paciente', patientId: p.id, semConta: true }, (tx) => tx.execute(sql`select * from app_ia_nutri_perguntar('oi', null, null, '1.0', 'teste')`), app.db)).rejects.toSatisfy(negadoPor('só roda na sessão de paciente'));
    await expect(perguntar(ctxP, 'x'.repeat(501))).rejects.toMatchObject({ code: '22023' });
    await expect(perguntar(ctxP, '   ')).rejects.toMatchObject({ code: '22023' });
    await expect(perguntar(ctxP, 'dor', { risco: 'emergencia', textoFixo: 'risco_transtorno' })).rejects.toMatchObject({ code: '22023' });
    await expect(perguntar(ctxP, 'dor', { risco: 'modelo', textoFixo: 'risco_emergencia' })).rejects.toMatchObject({ code: '22023' });
    // um dos dois nulo (a comparação com nulo não pode deixar passar: risco sem texto fixo, ou texto fixo sem risco)
    await expect(perguntar(ctxP, 'dor', { textoFixo: 'risco_emergencia' })).rejects.toMatchObject({ code: '22023' });
    await expect(perguntar(ctxP, 'dor', { risco: 'emergencia' })).rejects.toMatchObject({ code: '22023' });
    await expect(perguntar(ctxP, 'dor', { risco: 'transtorno_alimentar' })).rejects.toMatchObject({ code: '22023' });
    expect((await perguntar(ctxP, 'x'.repeat(500))).codigo).toBe('ok');
  });
});

describe('0117: app_ia_nutri_revogar (RN-182, D22, D32)', () => {
  it('evento revogacao, fila cancelada, conteúdo apagado e esqueleto até o fim do mês; o limite continua', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const fila = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'na_fila', contouNoLimite: false });
    const [r] = (await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar('203.0.113.9', 'teste')`), app.db)).rows as { revogacao_id: string; canceladas: number }[];
    expect(r.canceladas).toBe(1);
    const [c] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select evento, canal, registrado_por, ip, user_agent from ia_nutri_consentimentos where id = ${r.revogacao_id}`), app.db)).rows;
    expect(c).toEqual({ evento: 'revogacao', canal: 'app', registrado_por: ctxP.actorUserId, ip: '203.0.113.9', user_agent: 'teste' });
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select id, texto, status, revogada_em is not null as rev, expira_em, contou_no_limite from ia_nutri_mensagens where patient_id = ${p.id}`), app.db)).rows as { id: string; texto: string | null; status: string; rev: boolean; expira_em: string; contou_no_limite: boolean }[];
    expect(linhas.every((l) => l.texto === null && l.rev)).toBe(true);
    expect(linhas.find((l) => l.id === fila)?.status).toBe('cancelada');
    expect(new Date(linhas[0].expira_em).getTime()).toBeLessThanOrEqual(Date.now() + 32 * 86_400_000);
    expect(linhas.filter((l) => l.contou_no_limite)).toHaveLength(10);
    await aceiteNoBanco(app.db, ctxP); // aceitar de novo no mesmo dia
    expect((await perguntar(ctxP, 'de novo')).codigo).toBe('limite_dia'); // D32: revogar não zera o limite
  });
  it('D32: o esqueleto vale até o fim do mês, mas a revogação nunca estende a guarda de quem já vencia antes', async () => {
    const { T, p, ctxP } = await pronto();
    const amanha = new Date(Date.now() + 86_400_000);
    const curta = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', expiraEm: amanha });
    const longa = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', contouNoLimite: false });
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db);
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select id, expira_em, (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month') at time zone 'America/Sao_Paulo' as fim from ia_nutri_mensagens where patient_id = ${p.id}`), app.db)).rows as { id: string; expira_em: string; fim: string }[];
    expect(new Date(linhas.find((l) => l.id === curta)!.expira_em).getTime()).toBe(Math.min(amanha.getTime(), new Date(linhas[0].fim).getTime()));
    expect(new Date(linhas.find((l) => l.id === longa)!.expira_em).getTime()).toBe(new Date(linhas[0].fim).getTime());
  });
  it('revogar de novo, sem aceite no meio, não grava outro evento (nulo, 0)', async () => {
    const { T, p, ctxP } = await pronto();
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db);
    const [r] = (await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db)).rows;
    expect(r).toEqual({ revogacao_id: null, canceladas: 0 });
    const [{ n }] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select count(*)::int as n from ia_nutri_consentimentos where patient_id = ${p.id} and evento = 'revogacao'`), app.db)).rows as { n: number }[];
    expect(n).toBe(1);
    expect((await perguntar(ctxP, 'oi')).codigo).toBe('indisponivel');
  });
  it('D22: a pergunta com risco ainda não aberta fica, com texto, até 30 dias; as outras perdem o conteúdo', async () => {
    const { T, p, ctxP } = await pronto();
    await perguntar(ctxP, 'quero sumir', { risco: 'emergencia', textoFixo: 'risco_emergencia' });
    const comum = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', texto: 'Posso trocar o arroz?' });
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db);
    const [risco] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select texto, risco, expira_em, revogada_em is not null as rev from ia_nutri_mensagens where patient_id = ${p.id} and autor = 'paciente' and risco is not null`), app.db)).rows as { texto: string; risco: string; expira_em: string; rev: boolean }[];
    expect(risco).toMatchObject({ texto: 'quero sumir', risco: 'emergencia', rev: true });
    expect(new Date(risco.expira_em).getTime()).toBeLessThanOrEqual(Date.now() + 30 * 86_400_000 + 60_000);
    const [outra] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select texto from ia_nutri_mensagens where id = ${comum}`), app.db)).rows;
    expect(outra).toEqual({ texto: null });
  });
  it('sem consentimento vigente → nada (nulo, 0); a revogação direta pela sessão é recusada', async () => {
    const T = await novoTenant(app.db);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    const ctxP = ctxPaciente(T.tenantId, p.id, userId);
    const [r] = (await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db)).rows as { revogacao_id: string | null; canceladas: number }[];
    expect(r).toEqual({ revogacao_id: null, canceladas: 0 });
    await expect(withTenant(ctxP, (tx) => tx.execute(sql`insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'revogacao', 'app', ${userId})`), app.db)).rejects.toSatisfy(violaRls);
  });
  it('DP-17: na sessão nutri, com o paciente arquivado, grava canal nutricionista e registrado_por = a usuária; o papel volta a nutri', async () => {
    const { T, p } = await pronto();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'arquivado' where id = ${p.id}`), app.db);
    const [r] = (await withTenant(T.ctx, async (tx) => {
      const x = (await tx.execute(sql`select * from app_ia_nutri_revogar(null, null, ${p.id})`)).rows;
      const [papel] = (await tx.execute(sql`select current_setting('app.role', true) as r, current_setting('app.patient_id', true) as p`)).rows as { r: string; p: string }[];
      expect(papel).toEqual({ r: 'nutri', p: '' });
      return x;
    }, app.db)) as { revogacao_id: string | null }[];
    expect(r.revogacao_id).not.toBeNull();
    const [c] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select canal, registrado_por from ia_nutri_consentimentos where id = ${r.revogacao_id}`), app.db)).rows;
    expect(c).toEqual({ canal: 'nutricionista', registrado_por: T.nutriId });
    // sem p_patient na sessão nutri, ou com p_patient na sessão de paciente → 42501; paciente de outro tenant → 42501
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db)).rejects.toSatisfy(negadoPor('app_ia_nutri_revogar'));
    const outro = await pronto();
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null, ${outro.p.id})`), app.db)).rejects.toSatisfy(negadoPor('app_ia_nutri_revogar'));
    await expect(withTenant(outro.ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null, ${outro.p.id})`), app.db)).rejects.toSatisfy(negadoPor('app_ia_nutri_revogar'));
    await expect(withTenant(worker(outro.T.tenantId), (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null, ${outro.p.id})`), app.db)).rejects.toSatisfy(negadoPor('app_ia_nutri_revogar'));
    // tenant e conta definidos, mas app.role nunca definido nesta conexão (current_setting → NULL, não ''): recusa, não cai
    // no ramo do paciente (conexão nova: numa conexão do pool que já rodou withTenant, o valor seria '')
    const nova = new Client({ connectionString: inject('appDatabaseUrl') });
    await nova.connect();
    try {
      await nova.query('begin');
      const [{ r }] = (await nova.query(`select current_setting('app.role', true) as r`)).rows;
      expect(r).toBeNull();
      await nova.query(`select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [outro.T.tenantId, T.nutriId]);
      await expect(nova.query('select * from app_ia_nutri_revogar(null, null, $1)', [outro.p.id])).rejects.toSatisfy(negadoPor('app_ia_nutri_revogar'));
      await nova.query('rollback');
    } finally {
      await nova.end();
    }
  });
  it('D22 de ponta a ponta: pergunta com risco → revogar → a equipe abre e apaga (a mensagem `sistema` fica com responde_a nulo)', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagem_id: risco } = await perguntar(ctxP, 'quero sumir', { risco: 'emergencia', textoFixo: 'risco_emergencia' });
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db);
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`update ia_nutri_mensagens set aberta_pela_nutri_em = now() where id = ${risco}`);
      await tx.execute(sql`delete from ia_nutri_mensagens where id = ${risco}`);
    }, app.db);
    const linhas = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select autor, responde_a from ia_nutri_mensagens where patient_id = ${p.id}`), app.db)).rows;
    expect(linhas).toEqual([{ autor: 'sistema', responde_a: null }]);
  });
});

describe('0117: app_ia_nutri_enviar_a_nutri (DP-16, §7.5, RN-178)', () => {
  const enviar = (ctxP: TenantContext, texto: string) =>
    withTenant(ctxP, async (tx) => (await tx.execute(sql`select * from app_ia_nutri_enviar_a_nutri(${texto}, '1.0', 'teste')`)).rows[0] as { codigo: string; mensagem_id: string | null }, app.db);
  it('com o limite do dia atingido: a pergunta vai direto à fila, sem job e sem contar no limite', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 10; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const r = await enviar(ctxP, 'Posso trocar o jantar de dia?');
    expect(r.codigo).toBe('encaminhada');
    const [m] = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select status, contou_no_limite, encaminhada_em is not null as fila, risco from ia_nutri_mensagens where id = ${r.mensagem_id}`), app.db)).rows;
    expect(m).toEqual({ status: 'respondida', contou_no_limite: false, fila: true, risco: null });
  });
  it('3 dúvidas abertas → limite, nada gravado; sem liberação ou sem consentimento → indisponivel', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 3; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', encaminhadaEm: new Date(), contouNoLimite: false });
    expect(await enviar(ctxP, 'mais uma')).toEqual({ codigo: 'limite', mensagem_id: null });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update ia_nutri_participacoes set bloqueada_em = now() where patient_id = ${p.id}`), app.db);
    expect((await enviar(ctxP, 'mais uma')).codigo).toBe('indisponivel');
    // sem consentimento vigente (revogado)
    const outro = await pronto();
    await withTenant(outro.ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar(null, null)`), app.db);
    expect((await enviar(outro.ctxP, 'mais uma')).codigo).toBe('indisponivel');
  });
  it('a dúvida com risco aberta não conta nas 3; o papel volta; fora da sessão de paciente → 42501; texto inválido → 22023', async () => {
    const { T, p, ctxP } = await pronto();
    for (let i = 0; i < 3; i++) await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', risco: 'emergencia', encaminhadaEm: new Date(), contouNoLimite: false });
    const r = await withTenant(ctxP, async (tx) => {
      const x = (await tx.execute(sql`select * from app_ia_nutri_enviar_a_nutri('Posso trocar o jantar?', '1.0', 'teste')`)).rows[0] as { codigo: string };
      const [papel] = (await tx.execute(sql`select current_setting('app.role', true) as r, current_setting('app.patient_id', true) as p`)).rows;
      return { ...x, papel };
    }, app.db);
    expect(r).toMatchObject({ codigo: 'encaminhada', papel: { r: 'paciente', p: p.id } });
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from app_ia_nutri_enviar_a_nutri('oi', '1.0', 'teste')`), app.db)).rejects.toSatisfy(negadoPor('só roda na sessão de paciente'));
    await expect(enviar(ctxP, 'x'.repeat(501))).rejects.toMatchObject({ code: '22023' });
  });
});

describe('0117: app_anonimizar_consentimentos_ia_nutri e admin_metricas_ia_nutri', () => {
  it('só no worker, com o paciente bloqueado à espera: tira IP, user-agent e conta; evento, versão, destino e data ficam', async () => {
    const { T, p, ctxP } = await pronto();
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select app_anonimizar_consentimentos_ia_nutri(${p.id})`), app.db)).rejects.toSatisfy(negadoPor('contexto worker'));
    // paciente ativo: o worker também é recusado
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select app_anonimizar_consentimentos_ia_nutri(${p.id})`), app.db)).rejects.toSatisfy(negadoPor('bloqueado à espera'));
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar('203.0.113.9', 'navegador')`), app.db);
    const antes = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select registrado_em from ia_nutri_consentimentos where patient_id = ${p.id} order by registrado_em`), app.db)).rows;
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select app_anonimizar_consentimentos_ia_nutri(${p.id})`), app.db);
    const cs = (await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`select evento, versao, destino, canal, registrado_por, ip, user_agent, registrado_em from ia_nutri_consentimentos where patient_id = ${p.id} order by registrado_em`), app.db)).rows;
    expect(cs).toEqual([
      { evento: 'aceite', versao: '1.0', destino: 'teste', canal: 'app', registrado_por: null, ip: null, user_agent: null, registrado_em: antes[0].registrado_em },
      { evento: 'revogacao', versao: null, destino: null, canal: 'app', registrado_por: null, ip: null, user_agent: null, registrado_em: antes[1].registrado_em },
    ]);
    // de outro tenant: recusa (o paciente não está neste tenant)
    const outro = await novoTenant(app.db);
    await expect(withTenant(worker(outro.tenantId), (tx) => tx.execute(sql`select app_anonimizar_consentimentos_ia_nutri(${p.id})`), app.db)).rejects.toSatisfy(negadoPor('bloqueado à espera'));
  });
  it('admin_metricas_ia_nutri: perguntas ao modelo e os dois escopos de ia_uso no mês, numa linha; recusa dentro de withTenant', async () => {
    const { T, p } = await pronto();
    await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida' });
    const r = await app.db.execute(sql`select * from admin_metricas_ia_nutri()`);
    const linha = (r.rows as Record<string, string>[]).find((x) => x.tenant_id === T.tenantId);
    // /code-review do PR #37: os dois escopos na mesma linha (o TS não subtrai mais a 0099)
    expect(linha).toEqual({ tenant_id: T.tenantId, perguntas_mes: '1', usos_mes: '0', custo_mes_micro_usd: '0', nutri_tarefas_mes: '0', nutri_custo_mes_micro_usd: '0' });
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_ia_nutri()`), app.db)).rejects.toMatchObject({ cause: { code: '55000' } });
  });
  it('admin_metricas_ia_nutri: separa os escopos de ia_uso (conversa_paciente × o resto) com o filtro de situação da 0099; o contexto volta vazio', async () => {
    const { T, p } = await pronto();
    // pergunta que não contou no limite (risco, envio direto) não entra em perguntas_mes
    await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'respondida', contouNoLimite: false });
    await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`insert into ia_uso (tenant_id, tarefa_id, tipo, modelo, prompt_versao, mes, custo_micro_usd, situacao)
      select ${T.tenantId}, gen_random_uuid(), x.tipo, 'claude-haiku-5-5', 't', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'), x.custo, x.situacao
        from (values ('conversa_paciente', 100, 'confirmado'), ('conversa_paciente', 50, 'estornado'), ('leitura_exame', 1000, 'reservado'), ('resumo_historico', 7, 'estornado')) as x(tipo, custo, situacao)`), app.db);
    const linha = await app.db.transaction(async (tx) => {
      const [l] = (await tx.execute(sql`select * from admin_metricas_ia_nutri() where tenant_id = ${T.tenantId}`)).rows as Record<string, string>[];
      const [ctx] = (await tx.execute(sql`select current_setting('app.tenant_id', true) as t, current_setting('app.role', true) as r`)).rows;
      expect(ctx).toEqual({ t: '', r: '' });
      return l;
    });
    expect(linha).toEqual({ tenant_id: T.tenantId, perguntas_mes: '0', usos_mes: '2', custo_mes_micro_usd: '100', nutri_tarefas_mes: '2', nutri_custo_mes_micro_usd: '1000' });
  });
});
