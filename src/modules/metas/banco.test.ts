import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 27 (spec §9.4): `metas_modelos`, `metas_paciente` e `metas_registros` no banco — RLS (staff_only, patient_rls,
 * paciente_meta_registro_com_conta), CHECKs, índices, FK composta, REVOKE e auditoria. Tudo por SQL cru, sem o módulo.
 * T1a: só o que não depende dos gatilhos metas_paciente_regras e metas_registros_regras nem de app_hoje_do_tenant (T1b).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const publico = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'publico' });
const semConta = (T: TenantDeTeste, patientId: string): TenantContext => ({ tenantId: T.tenantId, role: 'paciente', patientId, semConta: true });

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '' };
};
/** Recusa da RLS da própria tabela (WITH CHECK), nunca de outro motivo (um 23503 da FK passaria sem a patient_isolation). */
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const comCodigo = (codigo: string) => (e: unknown) => erro(e).code === codigo;

type Cenario = TenantDeTeste & { p: string; pac: TenantContext };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  const p = (await novoPaciente(app.db, T.ctx)).id;
  return { ...T, p, pac: ctxPaciente(T.tenantId, p) };
}

/** Hoje no fuso padrão dos tenants de teste (o gatilho da T1b confere o mesmo dia pelo fuso do tenant). */
const HOJE = sql`(now() at time zone 'America/Sao_Paulo')::date`;

const novaMeta = (C: Cenario, x: { paciente?: string; fim?: SQL } = {}) =>
  sql`insert into metas_paciente (tenant_id, patient_id, titulo, categoria, inicio, fim, criado_por)
      values (${C.tenantId}, ${x.paciente ?? C.p}, 'Beber 2 litros de água', 'agua', ${HOJE} - 1, ${x.fim ?? sql`null`}, ${C.nutriId})
      returning *`;
const meta = async (C: Cenario, paciente?: string) => (await em(C.ctx, novaMeta(C, { paciente })))[0];
const registro = (C: Cenario, metaId: unknown, x: { paciente?: string; dia?: SQL; cumprida?: boolean } = {}) =>
  sql`insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida)
      values (${C.tenantId}, ${x.paciente ?? C.p}, ${metaId}, ${x.dia ?? HOJE}, ${x.cumprida ?? true})
      returning *`;

describe('Plano 27 — metas_modelos (spec §9.4)', () => {
  it('staff_only: o paciente (com e sem conta), o publico e a conta não leem nenhum modelo; a nutricionista lê os do tenant', async () => {
    const C = await cenario();
    await em(C.ctx, sql`insert into metas_modelos (tenant_id, titulo, categoria, lembrete_sugerido) values (${C.tenantId}, 'Beber água', 'agua', 'agua')`);
    expect((await em(C.ctx, sql`select 1 from metas_modelos`)).length).toBe(1);
    expect(await em(C.pac, sql`select 1 from metas_modelos`)).toEqual([]);
    expect(await em(semConta(C, C.p), sql`select 1 from metas_modelos`)).toEqual([]);
    expect(await em(publico(C), sql`select 1 from metas_modelos`)).toEqual([]);
    expect((await withConta(randomUUID(), (tx) => tx.execute(sql`select 1 from metas_modelos`), app.db)).rows).toEqual([]);
    await expect(em(C.pac, sql`insert into metas_modelos (tenant_id, titulo, categoria) values (${C.tenantId}, 'Dormir 8 h', 'sono')`)).rejects.toSatisfy(
      rlsDe('metas_modelos'),
    );
  });

  it('título único sem diferença de maiúsculas entre os não arquivados (23505); arquivado libera o título; CHECKs', async () => {
    const C = await cenario();
    const ins = (titulo: string, extra: SQL = sql`'agua', null`) =>
      em(C.ctx, sql`insert into metas_modelos (tenant_id, titulo, categoria, lembrete_sugerido) values (${C.tenantId}, ${titulo}, ${extra}) returning *`);
    const [m] = await ins('Beber água');
    await expect(ins('BEBER ÁGUA')).rejects.toSatisfy(comCodigo('23505'));
    await em(C.ctx, sql`update metas_modelos set arquivado_em = now() where id = ${m.id}`);
    await expect(ins('beber água')).resolves.toHaveLength(1);
    await expect(ins('Ab')).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('x'.repeat(81))).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Correr', sql`'corrida', null`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Correr', sql`'atividade', 'alarme'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(
      em(C.ctx, sql`insert into metas_modelos (tenant_id, titulo, categoria, como_fazer) values (${C.tenantId}, 'Caminhar', 'atividade', ${'x'.repeat(301)})`),
    ).rejects.toSatisfy(comCodigo('23514'));
  });
});

describe('Plano 27 — metas_paciente (spec §9.4)', () => {
  it('INSERT recusado pela RLS: paciente, publico e outro tenant', async () => {
    const C = await cenario();
    const D = await cenario();
    await expect(em(C.pac, novaMeta(C))).rejects.toSatisfy(rlsDe('metas_paciente'));
    await expect(em(semConta(C, C.p), novaMeta(C))).rejects.toSatisfy(rlsDe('metas_paciente'));
    await expect(em(publico(C), novaMeta(C))).rejects.toSatisfy(rlsDe('metas_paciente'));
    await expect(em(D.ctx, novaMeta(C))).rejects.toSatisfy(rlsDe('metas_paciente'));
    expect((await owner.pool.query('select count(*)::int as n from metas_paciente where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });

  it('o paciente lê as próprias metas, mas UPDATE e SELECT … FOR SHARE dão 0 linhas (paciente_sem_update, QP-D34)', async () => {
    const C = await cenario();
    const m = await meta(C);
    expect((await em(C.pac, sql`select id from metas_paciente`)).map((r) => r.id)).toEqual([m.id]);
    expect(await em(C.pac, sql`update metas_paciente set situacao = 'encerrada', encerrada_em = now() where id = ${m.id} returning id`)).toEqual([]);
    expect(await em(C.pac, sql`select id from metas_paciente where id = ${m.id} for share`)).toEqual([]);
    expect(await em(C.pac, sql`select id from metas_paciente where id = ${m.id} for key share`)).toEqual([]);
    const outro = (await novoPaciente(app.db, C.ctx)).id;
    expect(await em(ctxPaciente(C.tenantId, outro), sql`select 1 from metas_paciente`)).toEqual([]);
  });

  it('CHECKs: fim entre inicio e inicio + 365; situação válida e encerrada_em só fora de "ativa"; título e categoria', async () => {
    const C = await cenario();
    await expect(em(C.ctx, novaMeta(C, { fim: sql`${HOJE} - 2` }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, novaMeta(C, { fim: sql`${HOJE} - 1 + 366` }))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, novaMeta(C, { fim: sql`${HOJE} - 1 + 365` }))).resolves.toHaveLength(1);
    const m = await meta(C);
    await expect(em(C.ctx, sql`update metas_paciente set situacao = 'alcancada' where id = ${m.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`update metas_paciente set encerrada_em = now() where id = ${m.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`update metas_paciente set situacao = 'pausada', encerrada_em = now() where id = ${m.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`update metas_paciente set titulo = 'Ab' where id = ${m.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`update metas_paciente set categoria = 'corrida' where id = ${m.id}`)).rejects.toSatisfy(comCodigo('23514'));
    const [alc] = await em(C.ctx, sql`update metas_paciente set situacao = 'alcancada', encerrada_em = now() where id = ${m.id} returning situacao`);
    expect(alc.situacao).toBe('alcancada');
  });

  it('DELETE e TRUNCATE revogados (42501 de permissão)', async () => {
    const C = await cenario();
    await meta(C);
    await expect(em(C.ctx, sql`delete from metas_paciente`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.ctx, sql`truncate metas_paciente`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.pac, sql`delete from metas_paciente`)).rejects.toSatisfy(permissaoNegada);
  });

  it('auditoria: as escritas saem com a entidade "metas", sem o título', async () => {
    const C = await cenario();
    const m = await meta(C);
    await em(C.ctx, sql`update metas_paciente set situacao = 'encerrada', encerrada_em = now() where id = ${m.id}`);
    const { rows } = await owner.pool.query('select * from audit_log where entidade_id = $1 order by criado_em', [m.id]);
    expect(rows.map((r) => [r.acao, r.entidade, r.actor_user_id, r.patient_id])).toEqual([
      ['criar', 'metas', C.nutriId, C.p],
      ['alterar', 'metas', C.nutriId, C.p],
    ]);
    expect(JSON.stringify(rows)).not.toContain('Beber');
  });
});

describe('Plano 27 — metas_registros (spec §9.4, RN-547)', () => {
  it('o paciente com conta registra e troca cumprida; um registro por meta e dia (23505)', async () => {
    const C = await cenario();
    const m = await meta(C);
    const [r] = await em(C.pac, registro(C, m.id, { cumprida: false }));
    expect(r).toMatchObject({ meta_id: m.id, cumprida: false });
    expect(r.registrado_em).toBeTruthy();
    expect(r.atualizado_em).toBeTruthy();
    await expect(em(C.pac, registro(C, m.id))).rejects.toSatisfy(comCodigo('23505'));
    const [t] = await em(C.pac, sql`update metas_registros set cumprida = true where id = ${r.id} returning cumprida`);
    expect(t.cumprida).toBe(true);
    // UPDATE sem mudança passa
    expect(await em(C.pac, sql`update metas_registros set cumprida = cumprida where id = ${r.id} returning id`)).toHaveLength(1);
  });

  it('paciente sem conta (link) não lê nem grava (paciente_meta_registro_com_conta)', async () => {
    const C = await cenario();
    const m = await meta(C);
    const [r] = await em(C.pac, registro(C, m.id));
    await expect(em(semConta(C, C.p), registro(C, m.id, { dia: sql`${HOJE} - 1` }))).rejects.toSatisfy(rlsDe('metas_registros'));
    expect(await em(semConta(C, C.p), sql`select 1 from metas_registros`)).toEqual([]);
    expect(await em(semConta(C, C.p), sql`update metas_registros set cumprida = not cumprida where id = ${r.id} returning id`)).toEqual([]);
  });

  it('meta de outro paciente: P2 grava com patient_id = P1 e a meta de P1 → 42501 da RLS de metas_registros (nunca 23503)', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const deP1 = await meta(C);
    await meta(C, p2);
    await expect(em(ctxPaciente(C.tenantId, p2), registro(C, deP1.id))).rejects.toSatisfy(rlsDe('metas_registros'));
    const [r] = await em(C.pac, registro(C, deP1.id));
    expect(await em(ctxPaciente(C.tenantId, p2), sql`select 1 from metas_registros`)).toEqual([]);
    expect(await em(ctxPaciente(C.tenantId, p2), sql`update metas_registros set cumprida = false where id = ${r.id} returning id`)).toEqual([]);
  });

  it('publico e outro tenant → 42501 da RLS; leem 0 linhas', async () => {
    const C = await cenario();
    const D = await cenario();
    const m = await meta(C);
    await em(C.pac, registro(C, m.id));
    await expect(em(publico(C), registro(C, m.id, { dia: sql`${HOJE} - 1` }))).rejects.toSatisfy(rlsDe('metas_registros'));
    await expect(em(D.ctx, registro(C, m.id, { dia: sql`${HOJE} - 1` }))).rejects.toSatisfy(rlsDe('metas_registros'));
    expect(await em(publico(C), sql`select 1 from metas_registros`)).toEqual([]);
    expect(await em(D.ctx, sql`select 1 from metas_registros`)).toEqual([]);
    expect((await withConta(randomUUID(), (tx) => tx.execute(sql`select 1 from metas_registros`), app.db)).rows).toEqual([]);
  });

  it('DELETE e TRUNCATE revogados (42501 de permissão), também para o paciente', async () => {
    const C = await cenario();
    const m = await meta(C);
    await em(C.pac, registro(C, m.id));
    await expect(em(C.pac, sql`delete from metas_registros`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.ctx, sql`delete from metas_registros`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.ctx, sql`truncate metas_registros`)).rejects.toSatisfy(permissaoNegada);
  });

  it('auditoria: o criar e o alterar saem com a entidade "metas_registro" e o ator do paciente', async () => {
    const C = await cenario();
    const m = await meta(C);
    const [r] = await em(C.pac, registro(C, m.id));
    await em(C.pac, sql`update metas_registros set cumprida = false where id = ${r.id}`);
    const { rows } = await owner.pool.query('select * from audit_log where entidade_id = $1 order by criado_em', [r.id]);
    expect(rows.map((x) => [x.acao, x.entidade, x.actor_user_id, x.patient_id])).toEqual([
      ['criar', 'metas_registro', C.pac.actorUserId, C.p],
      ['alterar', 'metas_registro', C.pac.actorUserId, C.p],
    ]);
  });
});
