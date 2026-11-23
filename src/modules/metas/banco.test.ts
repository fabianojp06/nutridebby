import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 27 (spec §9.4): `metas_modelos`, `metas_paciente` e `metas_registros` no banco — RLS (staff_only, patient_rls,
 * paciente_meta_registro_com_conta), CHECKs, índices, FK composta, REVOKE e auditoria. Tudo por SQL cru, sem o módulo.
 * T1a: RLS, CHECKs, índices, FK, REVOKE e auditoria; T1b: os gatilhos metas_paciente_regras e metas_registros_regras,
 * app_dia_no_fuso/app_hoje_do_tenant (QP-D56) e a concorrência do registro com "Encerrar" e "mudar início" (QP-D33).
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
/** Recusa de um gatilho (42501), nem da RLS nem de permissão. */
const doGatilho = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && !/row-level security|permission denied/.test(message);
};
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
/** O contexto vazio do dono (migration, semente, fábrica do isolamento): sem tenant nem papel, com os gatilhos ligados. */
const dono = async (q: SQL): Promise<Row[]> => (await owner.db.execute(q)).rows as Row[];

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

// ---------------------------------------------------------------------------------------------------------------------
// T1b: gatilhos metas_paciente_regras e metas_registros_regras, app_dia_no_fuso e app_hoje_do_tenant
// ---------------------------------------------------------------------------------------------------------------------

const atualizarMeta = (ctx: TenantContext, id: unknown, set: SQL) => em(ctx, sql`update metas_paciente set ${set} where id = ${id} returning *`);
const atualizarRegistro = (ctx: TenantContext, id: unknown, set: SQL) => em(ctx, sql`update metas_registros set ${set} where id = ${id} returning *`);
const bloquear = (C: Cenario, paciente = C.p) =>
  em(C.ctx, sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${paciente}`);
const arquivar = (C: Cenario, paciente = C.p) => em(C.ctx, sql`update patients set status = 'arquivado' where id = ${paciente}`);
/** Anonimizado ainda "ativo", gravado sem os gatilhos: prova que o gatilho olha `anonimizado_em` sozinho. */
const anonimizar = (paciente: string) =>
  owner.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`update patients set anonimizado_em = now() where id = ${paciente}`);
  });

describe('Plano 27 — gatilho metas_paciente_regras (spec §9.4, QP-D34, QP-D35, QP-D59)', () => {
  it('INSERT da nutricionista grava criado_por = a usuária da sessão (ignora o mandado); o contexto vazio grava o mandado', async () => {
    const C = await cenario();
    const outra = randomUUID();
    const ins = sql`insert into metas_paciente (tenant_id, patient_id, titulo, categoria, inicio, criado_por)
                    values (${C.tenantId}, ${C.p}, 'Dormir 8 horas', 'sono', ${HOJE}, ${outra}) returning *`;
    expect((await em(C.ctx, ins))[0].criado_por).toBe(C.nutriId);
    expect((await dono(ins))[0].criado_por).toBe(outra);
  });

  it('worker no próprio tenant: INSERT e UPDATE → 42501 do gatilho (QP-D59); o UPDATE sem mudança passa', async () => {
    const C = await cenario();
    await expect(em(worker(C), novaMeta(C))).rejects.toSatisfy(doGatilho);
    const m = await meta(C);
    await expect(atualizarMeta(worker(C), m.id, sql`situacao = 'encerrada', encerrada_em = now()`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarMeta(worker(C), m.id, sql`fim = inicio + 10`)).rejects.toSatisfy(doGatilho);
    expect(await atualizarMeta(worker(C), m.id, sql`situacao = situacao`)).toHaveLength(1);
    expect(await atualizarMeta(C.ctx, m.id, sql`titulo = titulo`)).toHaveLength(1);
    expect(await dono(sql`update metas_paciente set tenant_id = tenant_id where id = ${m.id} returning id`)).toHaveLength(1);
  });

  it('INSERT do paciente, do publico, da conta e de outro tenant: o gatilho devolve NEW e a RLS recusa (QP-D35)', async () => {
    const C = await cenario();
    const D = await cenario();
    for (const ctx of [C.pac, semConta(C, C.p), publico(C), D.ctx, worker(D)]) {
      await expect(em(ctx, novaMeta(C)), ctx.role).rejects.toSatisfy(rlsDe('metas_paciente'));
    }
    await expect(withConta(randomUUID(), (tx) => tx.execute(novaMeta(C)), app.db)).rejects.toSatisfy(rlsDe('metas_paciente'));
  });

  it('"ativa" → "alcancada" ou "encerrada", sem volta', async () => {
    const C = await cenario();
    const m = await meta(C);
    const n = await meta(C);
    expect((await atualizarMeta(C.ctx, m.id, sql`situacao = 'alcancada', encerrada_em = now()`))[0].situacao).toBe('alcancada');
    await expect(atualizarMeta(C.ctx, m.id, sql`situacao = 'ativa', encerrada_em = null`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarMeta(C.ctx, m.id, sql`situacao = 'encerrada'`)).rejects.toSatisfy(doGatilho);
    expect((await atualizarMeta(C.ctx, n.id, sql`situacao = 'encerrada', encerrada_em = now()`))[0].situacao).toBe('encerrada');
    await expect(atualizarMeta(C.ctx, n.id, sql`situacao = 'ativa', encerrada_em = null`)).rejects.toSatisfy(doGatilho);
    await expect(dono(sql`update metas_paciente set situacao = 'ativa', encerrada_em = null where id = ${n.id}`)).rejects.toSatisfy(doGatilho);
  });

  it('inicio: muda enquanto não há registro; depois do primeiro registro → 42501', async () => {
    const C = await cenario();
    const m = await meta(C);
    expect((await atualizarMeta(C.ctx, m.id, sql`inicio = ${HOJE} - 2`))[0].inicio).toBeTruthy();
    await em(C.pac, registro(C, m.id));
    await expect(atualizarMeta(C.ctx, m.id, sql`inicio = ${HOJE} - 1`)).rejects.toSatisfy(doGatilho);
    await expect(dono(sql`update metas_paciente set inicio = inicio - 1 where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    // o resto (título, fim) continua editável
    expect(await atualizarMeta(C.ctx, m.id, sql`titulo = 'Beber 2,5 litros de água', fim = inicio + 30`)).toHaveLength(1);
  });

  it('colunas fixas (id, paciente, autora, created_at) → 42501; tenant de fora → RLS', async () => {
    const C = await cenario();
    const D = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const m = await meta(C);
    for (const set of [sql`id = ${randomUUID()}`, sql`patient_id = ${p2}`, sql`criado_por = ${randomUUID()}`, sql`created_at = created_at - interval '1 hour'`]) {
      await expect(atualizarMeta(C.ctx, m.id, set)).rejects.toSatisfy(doGatilho);
      await expect(dono(sql`update metas_paciente set ${set} where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    }
    await expect(dono(sql`update metas_paciente set tenant_id = ${D.tenantId} where id = ${m.id}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarMeta(C.ctx, m.id, sql`tenant_id = ${D.tenantId}`)).rejects.toSatisfy(rlsDe('metas_paciente'));
  });
});

describe('Plano 27 — gatilho metas_registros_regras (RN-547, QP-D33, QP-D35)', () => {
  it('o paciente registra hoje e ontem (fuso do tenant) e troca cumprida; anteontem e amanhã → 42501', async () => {
    const C = await cenario();
    const m = (await em(C.ctx, sql`insert into metas_paciente (tenant_id, patient_id, titulo, categoria, inicio, criado_por)
                                   values (${C.tenantId}, ${C.p}, 'Caminhar 30 minutos', 'atividade', ${HOJE} - 10, ${C.nutriId}) returning id`))[0];
    const [hoje] = await em(C.pac, registro(C, m.id, { cumprida: false }));
    const [ontem] = await em(C.pac, registro(C, m.id, { dia: sql`${HOJE} - 1` }));
    expect([hoje.cumprida, ontem.cumprida]).toEqual([false, true]);
    expect((await atualizarRegistro(C.pac, hoje.id, sql`cumprida = true`))[0].cumprida).toBe(true);
    expect((await atualizarRegistro(C.pac, ontem.id, sql`cumprida = false`))[0].cumprida).toBe(false);
    await expect(em(C.pac, registro(C, m.id, { dia: sql`${HOJE} - 2` }))).rejects.toSatisfy(doGatilho);
    await expect(em(C.pac, registro(C, m.id, { dia: sql`${HOJE} + 1` }))).rejects.toSatisfy(doGatilho);
    // o ON CONFLICT … DO UPDATE do módulo (o mesmo dia): passa pelo ramo UPDATE do gatilho
    const [up] = await em(
      C.pac,
      sql`insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida) values (${C.tenantId}, ${C.p}, ${m.id}, app_hoje_do_tenant(), false)
          on conflict (tenant_id, meta_id, dia) do update set cumprida = excluded.cumprida returning *`,
    );
    expect(up).toMatchObject({ id: hoje.id, cumprida: false });
  });

  it('registrado_em e atualizado_em do relógio do banco (o valor mandado não vale); no UPDATE só cumprida muda', async () => {
    const C = await cenario();
    const m = await meta(C);
    const [r] = await em(
      C.pac,
      sql`insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida, registrado_em, atualizado_em)
          values (${C.tenantId}, ${C.p}, ${m.id}, ${HOJE}, true, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z') returning *`,
    );
    // o execute do drizzle devolve timestamptz como texto
    const ms = (v: unknown) => new Date(v as string).getTime();
    for (const col of ['registrado_em', 'atualizado_em']) expect(Math.abs(ms(r[col]) - Date.now()), col).toBeLessThan(5 * 60_000);
    const [u] = await atualizarRegistro(C.pac, r.id, sql`cumprida = false, atualizado_em = '2000-01-01T00:00:00Z'`);
    expect(ms(u.atualizado_em)).toBeGreaterThanOrEqual(ms(r.atualizado_em));
    expect(u.registrado_em).toEqual(r.registrado_em);
    const outra = await meta(C);
    await expect(atualizarRegistro(C.pac, r.id, sql`dia = ${HOJE} - 1`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarRegistro(C.pac, r.id, sql`meta_id = ${outra.id}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarRegistro(C.pac, r.id, sql`registrado_em = now()`)).rejects.toSatisfy(doGatilho);
    // UPDATE sem mudança passa (o UPDATE_DO_PACIENTE do isolamento)
    expect(await atualizarRegistro(C.pac, r.id, sql`cumprida = cumprida`)).toHaveLength(1);
  });

  it('dia antes do início, meta encerrada ou alcançada, dia depois do fim (meta terminada) → 42501', async () => {
    const C = await cenario();
    const nova = (inicio: SQL, fim: SQL = sql`null`) =>
      em(C.ctx, sql`insert into metas_paciente (tenant_id, patient_id, titulo, categoria, inicio, fim, criado_por)
                    values (${C.tenantId}, ${C.p}, 'Comer frutas', 'alimentacao', ${inicio}, ${fim}, ${C.nutriId}) returning id`).then((r) => r[0].id);
    const comecaHoje = await nova(HOJE);
    await expect(em(C.pac, registro(C, comecaHoje, { dia: sql`${HOJE} - 1` }))).rejects.toSatisfy(doGatilho);
    await expect(em(C.pac, registro(C, comecaHoje))).resolves.toHaveLength(1);
    const terminou = await nova(sql`${HOJE} - 5`, sql`${HOJE} - 1`);
    await expect(em(C.pac, registro(C, terminou))).rejects.toSatisfy(doGatilho);
    await expect(em(C.pac, registro(C, terminou, { dia: sql`${HOJE} - 1` }))).resolves.toHaveLength(1);
    for (const situacao of ['encerrada', 'alcancada']) {
      const x = await nova(sql`${HOJE} - 1`);
      await atualizarMeta(C.ctx, x, sql`situacao = ${situacao}, encerrada_em = now()`);
      await expect(em(C.pac, registro(C, x)), situacao).rejects.toSatisfy(doGatilho);
    }
    // a meta encerrada depois do registro: nem a troca de "cumprida" passa
    const y = await nova(sql`${HOJE} - 1`);
    const [r] = await em(C.pac, registro(C, y));
    await atualizarMeta(C.ctx, y, sql`situacao = 'encerrada', encerrada_em = now()`);
    await expect(atualizarRegistro(C.pac, r.id, sql`cumprida = false`)).rejects.toSatisfy(doGatilho);
  });

  it('titular bloqueado, arquivado ou anonimizado → 42501 do gatilho', async () => {
    for (const preparar of [(C: Cenario) => bloquear(C), (C: Cenario) => arquivar(C), (C: Cenario) => anonimizar(C.p)]) {
      const C = await cenario();
      const m = await meta(C);
      await preparar(C);
      await expect(em(C.pac, registro(C, m.id))).rejects.toSatisfy(doGatilho);
    }
  });

  it('a meta de outro paciente com o próprio patient_id → 42501 do gatilho (nunca 23503); com o patient_id do outro → RLS', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const deP1 = await meta(C);
    const pac2 = ctxPaciente(C.tenantId, p2);
    await expect(em(pac2, registro(C, deP1.id, { paciente: p2 }))).rejects.toSatisfy(doGatilho);
    await expect(em(pac2, registro(C, deP1.id))).rejects.toSatisfy(rlsDe('metas_registros'));
  });

  it('nutri e worker no próprio tenant → 42501 do gatilho; o contexto vazio passa; publico, conta e outro tenant → RLS', async () => {
    const C = await cenario();
    const D = await cenario();
    const m = await meta(C);
    await expect(em(C.ctx, registro(C, m.id))).rejects.toSatisfy(doGatilho);
    await expect(em(worker(C), registro(C, m.id))).rejects.toSatisfy(doGatilho);
    const [r] = await em(C.pac, registro(C, m.id));
    await expect(atualizarRegistro(C.ctx, r.id, sql`cumprida = false`)).rejects.toSatisfy(doGatilho);
    await expect(atualizarRegistro(worker(C), r.id, sql`cumprida = false`)).rejects.toSatisfy(doGatilho);
    expect(await atualizarRegistro(C.ctx, r.id, sql`cumprida = cumprida`)).toHaveLength(1);
    expect(await atualizarRegistro(worker(C), r.id, sql`cumprida = cumprida`)).toHaveLength(1);
    await expect(dono(registro(C, m.id, { dia: sql`${HOJE} - 1` }))).resolves.toHaveLength(1);
    for (const ctx of [publico(C), D.ctx, worker(D)]) await expect(em(ctx, registro(C, m.id, { dia: sql`${HOJE} - 1` })), ctx.role).rejects.toSatisfy(rlsDe('metas_registros'));
    await expect(withConta(randomUUID(), (tx) => tx.execute(registro(C, m.id)), app.db)).rejects.toSatisfy(rlsDe('metas_registros'));
  });
});

describe('Plano 27 — dia no fuso do consultório (QP-D56)', () => {
  it('app_dia_no_fuso: 02:30 UTC de 18/11 ainda é 17/11 em São Paulo; 03:00 UTC já é 18/11', async () => {
    const { rows } = await app.pool.query(
      `select app_dia_no_fuso('2026-11-18 02:30:00+00', 'America/Sao_Paulo')::text as antes, app_dia_no_fuso('2026-11-18 03:00:00+00', 'America/Sao_Paulo')::text as depois,
              app_dia_no_fuso('2026-11-17 15:00:00+00', 'Asia/Tokyo')::text as toquio`,
    );
    expect(rows[0]).toEqual({ antes: '2026-11-17', depois: '2026-11-18', toquio: '2026-11-18' });
  });

  it('app_hoje_do_tenant() = app_dia_no_fuso(now(), tenants.fuso) do tenant da sessão; nulo sem app.tenant_id', async () => {
    const C = await cenario();
    const T = await cenario();
    await owner.pool.query(`update tenants set fuso = 'Pacific/Kiritimati' where id = $1`, [T.tenantId]);
    for (const [X, fuso] of [[C, 'America/Sao_Paulo'], [T, 'Pacific/Kiritimati']] as const) {
      const [r] = await em(X.ctx, sql`select app_hoje_do_tenant()::text as hoje, app_dia_no_fuso(now(), ${fuso})::text as esperado`);
      expect(r.hoje, fuso).toBe(r.esperado);
    }
    const { rows } = await app.pool.query('select app_hoje_do_tenant() as hoje');
    expect(rows[0].hoje).toBeNull();
    expect((await withConta(randomUUID(), (tx) => tx.execute(sql`select app_hoje_do_tenant() as hoje`), app.db)).rows[0].hoje).toBeNull();
  });

  it('o INSERT do paciente com app_hoje_do_tenant() - 1 grava ontem e o gatilho aceita (o mesmo now() da transação)', async () => {
    const C = await cenario();
    await owner.pool.query(`update tenants set fuso = 'Pacific/Kiritimati' where id = $1`, [C.tenantId]);
    const m = (await em(C.ctx, sql`insert into metas_paciente (tenant_id, patient_id, titulo, categoria, inicio, criado_por)
                                   values (${C.tenantId}, ${C.p}, 'Dormir cedo', 'sono', app_hoje_do_tenant() - 3, ${C.nutriId}) returning id`))[0];
    const [r] = await em(
      C.pac,
      sql`insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida) values (${C.tenantId}, ${C.p}, ${m.id}, app_hoje_do_tenant() - 1, true)
          returning dia::text as dia, (app_dia_no_fuso(now(), 'Pacific/Kiritimati') - 1)::text as ontem`,
    );
    expect(r.dia).toBe(r.ontem);
    await expect(em(C.pac, sql`insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida) values (${C.tenantId}, ${C.p}, ${m.id}, app_hoje_do_tenant() - 2, true)`)).rejects.toSatisfy(doGatilho);
  });

  it('EXECUTE revogado de PUBLIC e concedido ao role da aplicação; search_path fixo', async () => {
    const { rows } = await app.pool.query<{ proname: string; publico: boolean; app: boolean; config: string[] | null }>(`
      select p.proname,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
             has_function_privilege('nutri_app_role', p.oid, 'EXECUTE') as app, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('app_dia_no_fuso', 'app_hoje_do_tenant') order by p.proname`);
    expect(rows.map((r) => [r.proname, r.publico, r.app, r.config])).toEqual([
      ['app_dia_no_fuso', false, true, ['search_path=public, pg_temp']],
      ['app_hoje_do_tenant', false, true, ['search_path=public, pg_temp']],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Concorrência (QP-D33, RN-546, RN-547): a trava do titular serializa o registro com "Encerrar" e com "mudar início"
// ---------------------------------------------------------------------------------------------------------------------

type Conexao = { c: PoolClient; pid: number };
async function abrir(ctx: TenantContext): Promise<Conexao> {
  const c = await app.pool.connect();
  await c.query('begin');
  await c.query(
    `select set_config('app.tenant_id', $1, true), set_config('app.role', $2, true), set_config('app.patient_id', $3, true), set_config('app.user_id', $4, true)`,
    [ctx.tenantId, ctx.role, ctx.patientId ?? '', ctx.actorUserId ?? ''],
  );
  return { c, pid: (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number };
}
async function fechar(...xs: Conexao[]) {
  for (const x of xs) {
    await x.c.query('rollback').catch(() => undefined);
    x.c.release();
  }
}
async function esperarTrava(pid: number) {
  for (let i = 0; i < 400; i++) {
    const { rows } = await owner.pool.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('a conexão não chegou a esperar a trava');
}
const capturar = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** A equipe (encerrar/editar): carregarPacienteParaEscrita (FOR UPDATE) e depois o UPDATE da meta. */
const EQUIPE = async (x: Conexao, C: Cenario, metaId: unknown, set: string) => {
  await x.c.query('select 1 from patients where id = $1 for update', [C.p]);
  return x.c.query(`update metas_paciente set ${set} where id = $1`, [metaId]);
};
/** O paciente (registrarMeta): trava o próprio titular FOR KEY SHARE e depois o INSERT com o dia calculado no banco. */
const REGISTRAR = async (x: Conexao, C: Cenario, metaId: unknown, menos: 0 | 1) => {
  await x.c.query('select 1 from patients where id = $1 for key share', [C.p]);
  return x.c.query(
    `insert into metas_registros (tenant_id, patient_id, meta_id, dia, cumprida) values ($1, $2, $3, app_hoje_do_tenant() - $4::int, true)
     on conflict (tenant_id, meta_id, dia) do update set cumprida = excluded.cumprida`,
    [C.tenantId, C.p, metaId, menos],
  );
};
const registros = async (metaId: unknown) => (await owner.pool.query('select count(*)::int as n from metas_registros where meta_id = $1', [metaId])).rows[0].n as number;

describe('Plano 27 — metas: concorrência do registro com a equipe (QP-D33)', () => {
  it('"Encerrar" trava primeiro: o registro espera e recebe 42501 (meta não ativa); nenhum 40P01', async () => {
    const C = await cenario();
    const m = await meta(C);
    const equipe = await abrir(C.ctx);
    const paciente = await abrir(C.pac);
    try {
      await EQUIPE(equipe, C, m.id, `situacao = 'encerrada', encerrada_em = now()`);
      const r = capturar(REGISTRAR(paciente, C, m.id, 0));
      await esperarTrava(paciente.pid);
      await equipe.c.query('commit');
      const e = await r;
      expect(e).toSatisfy(doGatilho);
      expect(erro(e).message).toContain('meta não ativa');
    } finally {
      await fechar(equipe, paciente);
    }
    expect(await registros(m.id)).toBe(0);
  });

  it('o registro trava primeiro: "Encerrar" espera e encerra depois; nenhum 40P01', async () => {
    const C = await cenario();
    const m = await meta(C);
    const paciente = await abrir(C.pac);
    const equipe = await abrir(C.ctx);
    try {
      await REGISTRAR(paciente, C, m.id, 0);
      const enc = capturar(EQUIPE(equipe, C, m.id, `situacao = 'encerrada', encerrada_em = now()`));
      await esperarTrava(equipe.pid);
      await paciente.c.query('commit');
      expect(await enc).toBeNull();
      await equipe.c.query('commit');
    } finally {
      await fechar(equipe, paciente);
    }
    expect(await registros(m.id)).toBe(1);
    expect((await owner.pool.query('select situacao from metas_paciente where id = $1', [m.id])).rows[0].situacao).toBe('encerrada');
  });

  it('"mudar início" trava primeiro: o registro de ontem espera e recebe 42501 (antes do novo início); sem write skew', async () => {
    const C = await cenario();
    const m = await meta(C); // inicio = ontem
    const equipe = await abrir(C.ctx);
    const paciente = await abrir(C.pac);
    try {
      await EQUIPE(equipe, C, m.id, `inicio = app_hoje_do_tenant()`);
      const r = capturar(REGISTRAR(paciente, C, m.id, 1));
      await esperarTrava(paciente.pid);
      await equipe.c.query('commit');
      expect(await r).toSatisfy(doGatilho);
    } finally {
      await fechar(equipe, paciente);
    }
    expect(await registros(m.id)).toBe(0);
  });

  it('o primeiro registro trava primeiro: "mudar início" espera e recebe 42501 (já há registro); sem write skew', async () => {
    const C = await cenario();
    const m = await meta(C);
    const paciente = await abrir(C.pac);
    const equipe = await abrir(C.ctx);
    try {
      await REGISTRAR(paciente, C, m.id, 1);
      const mudar = capturar(EQUIPE(equipe, C, m.id, `inicio = app_hoje_do_tenant()`));
      await esperarTrava(equipe.pid);
      await paciente.c.query('commit');
      expect(await mudar).toSatisfy(doGatilho);
    } finally {
      await fechar(equipe, paciente);
    }
    expect(await registros(m.id)).toBe(1);
  });
});
