import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 27 (spec §9.1, §9.2): `anamnesis_templates` (finalidade, envio automático, staff_only) e `questionario_envios` no
 * banco — RLS, CHECKs, índices, FKs, REVOKE e auditoria. Tudo por SQL cru, sem o módulo: é o que o banco garante sozinho.
 * T1a: RLS, CHECKs, índices, FKs, REVOKE e auditoria; T1b: o gatilho questionario_envios_regras (transições por papel, colunas
 * fixas, titular travado) e a concorrência com o bloqueio. O CHECK que nenhum papel alcança pelo gatilho (defesa em
 * profundidade) é provado pelo dono com os gatilhos desligados (`semGatilho`).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
const publico = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'publico' });
const semConta = (T: TenantDeTeste, patientId: string): TenantContext => ({ tenantId: T.tenantId, role: 'paciente', patientId, semConta: true });

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '' };
};
/** Recusa da RLS da própria tabela (WITH CHECK), nunca de outro motivo. */
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const comCodigo = (...codigos: string[]) => (e: unknown) => codigos.includes(erro(e).code ?? '');
/** Recusa do gatilho questionario_envios_regras (42501), nem da RLS nem de permissão. */
const doGatilho = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && !/row-level security|permission denied/.test(message);
};
/**
 * O dono grava com os gatilhos desligados (session_replication_role = replica, local à transação): prova o CHECK que o
 * gatilho já recusa antes, para qualquer papel (defesa em profundidade). Os CHECKs continuam valendo; FK e auditoria não.
 */
const semGatilho = (q: SQL) =>
  owner.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    return tx.execute(q);
  });

const SNAPSHOT = JSON.stringify({ nome: 'Pré-consulta', perguntas: [{ id: 'q1', tipo: 'texto_curto', rotulo: 'Objetivo', obrigatoria: true }] });

type Cenario = TenantDeTeste & { p: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  return { ...T, p: (await novoPaciente(app.db, T.ctx)).id };
}

/** Envio legal da sessão `nutri` (origem 'nutri', enviado_por = a usuária). */
const envioDaNutri = (C: Cenario, x: { paciente?: string; consulta?: string | null; snapshot?: string } = {}) =>
  sql`insert into questionario_envios (tenant_id, patient_id, appointment_id, modelo_snapshot, origem, enviado_por, expira_em)
      values (${C.tenantId}, ${x.paciente ?? C.p}, ${x.consulta ?? null}, ${x.snapshot ?? SNAPSHOT}::jsonb, 'nutri', ${C.nutriId}, now() + interval '14 days')
      returning *`;
/** Envio legal do `worker` (automático, sem enviado_por). */
const envioDoWorker = (C: Cenario, consulta: string | null = null) =>
  sql`insert into questionario_envios (tenant_id, patient_id, appointment_id, modelo_snapshot, origem, expira_em)
      values (${C.tenantId}, ${C.p}, ${consulta}, ${SNAPSHOT}::jsonb, 'automatico', now() + interval '3 days')
      returning *`;
const enviar = async (C: Cenario, x: Parameters<typeof envioDaNutri>[1] = {}) => (await em(C.ctx, envioDaNutri(C, x)))[0];

/** A resposta pelo app (sessão de paciente com conta): só enviado → respondido. */
const responder = (C: Cenario, id: unknown, respostas = '{"q1":"Emagrecer"}', paciente = C.p) =>
  em(
    ctxPaciente(C.tenantId, paciente),
    sql`update questionario_envios set situacao = 'respondido', respostas = ${respostas}::jsonb, respondido_via = 'app', respondido_em = now()
        where id = ${id} returning *`,
  );

let seqConsulta = 0;
const consulta = (C: Cenario, paciente = C.p) =>
  consultaDireta(app.db, C.ctx, paciente, new Date(Date.parse('2030-03-01T12:00:00Z') + ++seqConsulta * 2 * 3_600_000));

const modelo = (C: Cenario, colunas: SQL, valores: SQL, ctx: TenantContext = C.ctx) =>
  em(ctx, sql`insert into anamnesis_templates (tenant_id, nome, schema, ${colunas}) values (${C.tenantId}, 'Modelo', '{"perguntas":[]}', ${valores}) returning *`);

describe('Plano 27 — anamnesis_templates: finalidade e envio automático (spec §9.1)', () => {
  it('finalidade nasce "anamnese" (a imagem anterior grava sem a coluna)', async () => {
    const C = await cenario();
    const [m] = await em(C.ctx, sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${C.tenantId}, 'Antigo', '{"perguntas":[]}') returning *`);
    expect(m).toMatchObject({ finalidade: 'anamnese', envio_auto: null, envio_auto_dias: null });
  });

  it('CHECKs: questionário não vem da IA; envio automático só com os dias, só em questionário não arquivado; finalidade e valores válidos', async () => {
    const C = await cenario();
    // anamnesis_templates_ia_origem (0112) só deixa o worker gravar a origem IA: a recusa é do CHECK, antes da FK
    await expect(modelo(C, sql`finalidade, ia_geracao_id`, sql`'questionario', ${randomUUID()}`, worker(C))).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto`, sql`'questionario', 'primeira'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto_dias`, sql`'questionario', 2`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'anamnese', 'todas', 2`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias, arquivado_em`, sql`'questionario', 'todas', 2, now()`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade`, sql`'outra'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'sempre', 2`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'todas', 8`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'todas', 0`)).rejects.toSatisfy(comCodigo('23514'));
    const [ok] = await modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'primeira', 7`);
    expect(ok).toMatchObject({ finalidade: 'questionario', envio_auto: 'primeira', envio_auto_dias: 7 });
    // arquivar o modelo automático sem desligar o envio também cai no CHECK
    await expect(em(C.ctx, sql`update anamnesis_templates set arquivado_em = now() where id = ${ok.id}`)).rejects.toSatisfy(comCodigo('23514'));
  });

  it('um modelo automático por tenant (23505); outro tenant tem o seu', async () => {
    const C = await cenario();
    const D = await cenario();
    await modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'primeira', 2`);
    await expect(modelo(C, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'todas', 3`)).rejects.toSatisfy(comCodigo('23505'));
    await expect(modelo(D, sql`finalidade, envio_auto, envio_auto_dias`, sql`'questionario', 'todas', 3`)).resolves.toHaveLength(1);
  });

  it('padrão por finalidade: o de anamnese e o de questionário convivem; o segundo da mesma finalidade → 23505', async () => {
    const C = await cenario();
    await modelo(C, sql`finalidade, padrao`, sql`'anamnese', true`);
    await modelo(C, sql`finalidade, padrao`, sql`'questionario', true`);
    await expect(modelo(C, sql`finalidade, padrao`, sql`'anamnese', true`)).rejects.toSatisfy(comCodigo('23505'));
    await expect(modelo(C, sql`finalidade, padrao`, sql`'questionario', true`)).rejects.toSatisfy(comCodigo('23505'));
  });

  it('staff_only (QP-D25): o paciente, com e sem conta, não lê nenhum modelo; a nutricionista lê os do tenant', async () => {
    const C = await cenario();
    await modelo(C, sql`finalidade`, sql`'anamnese'`);
    await modelo(C, sql`finalidade`, sql`'questionario'`);
    expect((await em(C.ctx, sql`select 1 from anamnesis_templates`)).length).toBe(2);
    expect(await em(ctxPaciente(C.tenantId, C.p), sql`select 1 from anamnesis_templates`)).toEqual([]);
    expect(await em(semConta(C, C.p), sql`select 1 from anamnesis_templates`)).toEqual([]);
  });
});

describe('Plano 27 — questionario_envios no banco (spec §9.2)', () => {
  it('INSERT legal: a nutricionista (manual) e o worker (automático) gravam', async () => {
    const C = await cenario();
    const a = await consulta(C);
    const manual = await enviar(C, { consulta: a });
    expect(manual).toMatchObject({ origem: 'nutri', enviado_por: C.nutriId, situacao: 'enviado', respostas: null, anamnese_id: null });
    const [auto] = await em(worker(C), envioDoWorker(C));
    expect(auto).toMatchObject({ origem: 'automatico', enviado_por: null, situacao: 'enviado' });
  });

  it('INSERT recusado pela RLS: paciente com e sem conta (paciente_sem_insert), publico e outro tenant', async () => {
    const C = await cenario();
    const D = await cenario();
    await expect(em(ctxPaciente(C.tenantId, C.p), envioDaNutri(C))).rejects.toSatisfy(rlsDe('questionario_envios'));
    await expect(em(semConta(C, C.p), envioDaNutri(C))).rejects.toSatisfy(rlsDe('questionario_envios'));
    await expect(em(publico(C), envioDaNutri(C))).rejects.toSatisfy(rlsDe('questionario_envios'));
    await expect(em(D.ctx, envioDaNutri(C))).rejects.toSatisfy(rlsDe('questionario_envios'));
    expect((await owner.pool.query('select count(*)::int as n from questionario_envios where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });

  it('leitura: o paciente (com e sem conta) vê só os próprios envios; outro tenant e o publico não veem nenhum', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const D = await cenario();
    const e1 = await enviar(C);
    const e2 = await enviar(C, { paciente: p2 });
    expect((await em(ctxPaciente(C.tenantId, C.p), sql`select id from questionario_envios`)).map((r) => r.id)).toEqual([e1.id]);
    expect((await em(semConta(C, p2), sql`select id from questionario_envios`)).map((r) => r.id)).toEqual([e2.id]);
    expect(await em(D.ctx, sql`select 1 from questionario_envios`)).toEqual([]);
    expect(await em(publico(C), sql`select 1 from questionario_envios`)).toEqual([]);
    // P2 não alcança o envio de P1 (patient_isolation): 0 linhas, sem erro
    expect(await responder(C, e1.id, '{"q1":"x"}', p2)).toEqual([]);
  });

  it('CHECKs: origem × enviado_por, prazo, snapshot objeto, situação, via e motivo válidos', async () => {
    const C = await cenario();
    const insert = (colunas: SQL, valores: SQL) =>
      sql`insert into questionario_envios (tenant_id, patient_id, ${colunas}) values (${C.tenantId}, ${C.p}, ${valores})`;
    // origem × enviado_por e origem inválida: o gatilho recusa antes, para todo papel (o nutri só grava 'nutri' em nome
    // próprio; o worker e o contexto vazio, 'automatico' sem autora) — o CHECK fica de defesa, provado sem o gatilho
    const incoerentes = [
      insert(sql`modelo_snapshot, origem, expira_em`, sql`${SNAPSHOT}::jsonb, 'nutri', now() + interval '1 day'`),
      insert(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'automatico', ${C.nutriId}, now() + interval '1 day'`),
      insert(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'outra', ${C.nutriId}, now() + interval '1 day'`),
    ];
    for (const q of incoerentes) {
      await expect(em(C.ctx, q)).rejects.toSatisfy(doGatilho);
      await expect(semGatilho(q)).rejects.toSatisfy(comCodigo('23514'));
    }
    // prazo e snapshot: o envio legal da nutricionista passa pelo gatilho e cai no CHECK
    await expect(em(C.ctx, insert(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'nutri', ${C.nutriId}, now() - interval '1 day'`))).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, insert(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`'[]'::jsonb, 'nutri', ${C.nutriId}, now() + interval '1 day'`))).rejects.toSatisfy(comCodigo('23514'));
    const e = await enviar(C);
    // situação e motivo inválidos: o gatilho recusa a transição antes (nutri e worker); o CHECK, sem o gatilho
    const aberto = sql`update questionario_envios set situacao = 'aberto' where id = ${e.id}`;
    await expect(em(C.ctx, aberto)).rejects.toSatisfy(doGatilho);
    await expect(em(worker(C), aberto)).rejects.toSatisfy(doGatilho);
    await expect(semGatilho(aberto)).rejects.toSatisfy(comCodigo('23514'));
    const outroMotivo = sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId}, cancelado_motivo = 'outro' where id = ${e.id}`;
    await expect(em(C.ctx, outroMotivo)).rejects.toSatisfy(doGatilho);
    await expect(semGatilho(outroMotivo)).rejects.toSatisfy(comCodigo('23514'));
    // via inválida: o gatilho do paciente só confere 'app' (com login) e 'link' (sem); o resto é do CHECK
    await expect(
      em(ctxPaciente(C.tenantId, C.p), sql`update questionario_envios set situacao = 'respondido', respostas = '{}'::jsonb, respondido_via = 'whatsapp', respondido_em = now() where id = ${e.id}`),
    ).rejects.toSatisfy(comCodigo('23514'));
  });

  it('CHECKs da resposta: acima de 2.000.000 bytes → 23514; respondido sem respostas → 23514', async () => {
    const C = await cenario();
    const e = await enviar(C);
    const grande = JSON.stringify({ q1: 'x'.repeat(2_000_000) });
    await expect(responder(C, e.id, grande)).rejects.toSatisfy(comCodigo('23514'));
    await expect(
      em(ctxPaciente(C.tenantId, C.p), sql`update questionario_envios set situacao = 'respondido', respondido_via = 'app', respondido_em = now() where id = ${e.id}`),
    ).rejects.toSatisfy(comCodigo('23514'));
    expect((await responder(C, e.id))[0]).toMatchObject({ situacao: 'respondido', respondido_via: 'app', respostas: { q1: 'Emagrecer' } });
  });

  it('CHECKs do cancelamento: cancelado sem motivo → 23514; motivo "nutri" sem cancelado_por → 23514', async () => {
    const C = await cenario();
    const e = await enviar(C);
    // a nutricionista não chega ao CHECK: o gatilho exige o motivo e a autora da sessão (42501); o CHECK, sem o gatilho
    const semMotivo = sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId} where id = ${e.id}`;
    const semAutora = sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = 'nutri' where id = ${e.id}`;
    for (const q of [semMotivo, semAutora]) {
      await expect(em(C.ctx, q)).rejects.toSatisfy(doGatilho);
      await expect(semGatilho(q)).rejects.toSatisfy(comCodigo('23514'));
    }
    // cancelado sem cancelado_em: o cancelamento legal da nutricionista passa pelo gatilho e cai no CHECK
    await expect(
      em(C.ctx, sql`update questionario_envios set situacao = 'cancelado', cancelado_por = ${C.nutriId}, cancelado_motivo = 'nutri' where id = ${e.id}`),
    ).rejects.toSatisfy(comCodigo('23514'));
    const [ok] = await em(
      C.ctx,
      sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId}, cancelado_motivo = 'nutri' where id = ${e.id} returning *`,
    );
    expect(ok).toMatchObject({ situacao: 'cancelado', cancelado_motivo: 'nutri' });
  });

  it('anamnese_id: só em respondido; FK composta recusa a anamnese de outro paciente (23503); uma anamnese para um envio só', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const anamnese = async (paciente: string) =>
      (await em(C.ctx, sql`insert into anamneses (tenant_id, patient_id, template_snapshot, data) values (${C.tenantId}, ${paciente}, '{"nome":"Q","perguntas":[]}', '2026-11-20') returning id`))[0].id;
    const daP1 = await anamnese(C.p);
    const daP2 = await anamnese(p2);
    const aberto = await enviar(C);
    // num envio aberto: o gatilho recusa antes (42501); o CHECK anamnese_so_respondido, sem o gatilho
    await expect(em(C.ctx, sql`update questionario_envios set anamnese_id = ${daP1} where id = ${aberto.id}`)).rejects.toSatisfy(doGatilho);
    await expect(semGatilho(sql`update questionario_envios set anamnese_id = ${daP1} where id = ${aberto.id}`)).rejects.toSatisfy(comCodigo('23514'));
    const e = await enviar(C);
    await responder(C, e.id);
    await expect(em(C.ctx, sql`update questionario_envios set anamnese_id = ${daP2} where id = ${e.id}`)).rejects.toSatisfy(comCodigo('23503'));
    expect((await em(C.ctx, sql`update questionario_envios set anamnese_id = ${daP1} where id = ${e.id} returning anamnese_id`))[0].anamnese_id).toBe(daP1);
    const outro = await enviar(C);
    await responder(C, outro.id);
    await expect(em(C.ctx, sql`update questionario_envios set anamnese_id = ${daP1} where id = ${outro.id}`)).rejects.toSatisfy(comCodigo('23505'));
  });

  it('FK composta da consulta: a consulta de outro paciente → 23503', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const deP2 = await consulta(C, p2);
    await expect(enviar(C, { consulta: deP2 })).rejects.toSatisfy(comCodigo('23503'));
  });

  it('um envio aberto por consulta: enviado + enviado e respondido + enviado → 23505; cancelado + enviado passa; sem consulta, vários', async () => {
    const C = await cenario();
    const a = await consulta(C);
    const e = await enviar(C, { consulta: a });
    await expect(enviar(C, { consulta: a })).rejects.toSatisfy(comCodigo('23505'));
    await expect(em(worker(C), envioDoWorker(C, a))).rejects.toSatisfy(comCodigo('23505'));
    await responder(C, e.id);
    await expect(enviar(C, { consulta: a })).rejects.toSatisfy(comCodigo('23505'));

    const b = await consulta(C);
    const c = await enviar(C, { consulta: b });
    await em(C.ctx, sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId}, cancelado_motivo = 'nutri' where id = ${c.id}`);
    await expect(enviar(C, { consulta: b })).resolves.toMatchObject({ situacao: 'enviado' });

    await enviar(C);
    await expect(enviar(C)).resolves.toMatchObject({ appointment_id: null });
  });

  it('DELETE e TRUNCATE revogados (42501 de permissão) para a equipe, o worker e o paciente', async () => {
    const C = await cenario();
    await enviar(C);
    await expect(em(C.ctx, sql`delete from questionario_envios`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(worker(C), sql`delete from questionario_envios`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(ctxPaciente(C.tenantId, C.p), sql`delete from questionario_envios`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.ctx, sql`truncate questionario_envios`)).rejects.toSatisfy(permissaoNegada);
    expect((await owner.pool.query('select count(*)::int as n from questionario_envios where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(1);
  });

  it('escrita vira audit_log com a entidade "questionario", o ator e o IP — sem nenhum conteúdo (RN-551)', async () => {
    const C = await cenario();
    const marca = `MARCA-${randomUUID()}`;
    const snapshot = JSON.stringify({ nome: marca, perguntas: [{ id: 'q1', tipo: 'texto_curto', rotulo: marca, obrigatoria: true }] });
    const e = await enviar(C, { snapshot });
    const pac = ctxPaciente(C.tenantId, C.p);
    await withTenant(
      pac,
      (tx) => tx.execute(sql`update questionario_envios set situacao = 'respondido', respostas = ${JSON.stringify({ q1: marca })}::jsonb, respondido_via = 'app', respondido_em = now() where id = ${e.id}`),
      app.db,
    );
    const { rows } = await owner.pool.query('select * from audit_log where entidade_id = $1 order by criado_em', [e.id]);
    expect(rows.map((r) => [r.acao, r.entidade, r.actor_user_id])).toEqual([
      ['criar', 'questionario', C.nutriId],
      ['alterar', 'questionario', pac.actorUserId],
    ]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['acao', 'actor_user_id', 'criado_em', 'entidade', 'entidade_id', 'id', 'ip', 'patient_id', 'tenant_id']);
      expect(r).toMatchObject({ tenant_id: C.tenantId, patient_id: C.p });
    }
    expect(rows[0].ip).toBe('203.0.113.20');
    expect(JSON.stringify(rows)).not.toContain(marca);
  });
});


// ---------------------------------------------------------------------------------------------------------------------
// T1b: gatilho questionario_envios_regras (spec §9.2, RN-529, RN-533, RN-534, RN-535, QP-D33, QP-D35, QP-D59)
// ---------------------------------------------------------------------------------------------------------------------

/** O contexto vazio do dono (migration, semente): sem tenant nem papel na sessão, com os gatilhos ligados. */
const dono = async (q: SQL): Promise<Row[]> => (await owner.db.execute(q)).rows as Row[];
const atualizar = (ctx: TenantContext, id: unknown, set: SQL) => em(ctx, sql`update questionario_envios set ${set} where id = ${id} returning *`);
const ler = async (id: unknown) => (await owner.pool.query('select * from questionario_envios where id = $1', [id])).rows[0] as Row;
const bloquear = (C: Cenario, paciente = C.p) =>
  em(C.ctx, sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${paciente}`);
const arquivar = (C: Cenario, paciente = C.p) => em(C.ctx, sql`update patients set status = 'arquivado' where id = ${paciente}`);
/** Anonimizado ainda "ativo" (sem gatilho): prova que o gatilho olha `anonimizado_em` sozinho. */
const anonimizar = (paciente: string) => semGatilho(sql`update patients set anonimizado_em = now() where id = ${paciente}`);
/** Envio já vencido (o CHECK exige expira_em > enviado_em: o enviado_em também vai para trás). */
const vencer = (id: unknown) => semGatilho(sql`update questionario_envios set enviado_em = now() - interval '2 days', expira_em = now() - interval '1 minute' where id = ${id}`);
const moverConsulta = (C: Cenario, consultaId: string, inicio: SQL) =>
  em(C.ctx, sql`update appointments set inicio = ${inicio}, fim = ${inicio} + interval '1 hour' where id = ${consultaId}`);
const cancelarConsulta = (C: Cenario, consultaId: string) =>
  em(C.ctx, sql`update appointments set status = 'cancelada', cancelado_por = 'nutri', cancelada_em = now() where id = ${consultaId}`);
const inicioDa = (consultaId: string) => sql`(select a.inicio from appointments a where a.id = ${consultaId})`;
const insertAuto = (C: Cenario, paciente = C.p) =>
  sql`insert into questionario_envios (tenant_id, patient_id, modelo_snapshot, origem, expira_em)
      values (${C.tenantId}, ${paciente}, ${SNAPSHOT}::jsonb, 'automatico', now() + interval '1 day') returning *`;
const RESPONDIDO_APP = sql`situacao = 'respondido', respostas = '{"q1":"Emagrecer"}'::jsonb, respondido_via = 'app'`;
const RESPONDIDO_LINK = sql`situacao = 'respondido', respostas = '{"q1":"Emagrecer"}'::jsonb, respondido_via = 'link'`;
const cancelamento = (motivo: string, por: string | null) => sql`situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${por}, cancelado_motivo = ${motivo}`;

describe('Plano 27 — gatilho questionario_envios_regras: INSERT (spec §9.2, RN-533)', () => {
  it('a nutricionista só envia em nome próprio, como envio manual; o worker e o contexto vazio, só o automático sem autora', async () => {
    const C = await cenario();
    const ins = (origem: string, por: string | null) =>
      sql`insert into questionario_envios (tenant_id, patient_id, modelo_snapshot, origem, enviado_por, expira_em)
          values (${C.tenantId}, ${C.p}, ${SNAPSHOT}::jsonb, ${origem}, ${por}, now() + interval '1 day') returning *`;
    await expect(em(C.ctx, ins('nutri', randomUUID()))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, ins('automatico', null))).rejects.toSatisfy(doGatilho);
    await expect(em(worker(C), ins('nutri', C.nutriId))).rejects.toSatisfy(doGatilho);
    await expect(dono(ins('nutri', C.nutriId))).rejects.toSatisfy(doGatilho);
    expect((await em(C.ctx, ins('nutri', C.nutriId)))[0]).toMatchObject({ origem: 'nutri', enviado_por: C.nutriId, situacao: 'enviado' });
    expect((await em(worker(C), ins('automatico', null)))[0]).toMatchObject({ origem: 'automatico', enviado_por: null, situacao: 'enviado' });
    expect((await dono(ins('automatico', null)))[0]).toMatchObject({ origem: 'automatico', enviado_por: null, situacao: 'enviado' });
  });

  it('o envio nasce "enviado": nem respondido, nem cancelado, nem com anamnese (42501)', async () => {
    const C = await cenario();
    const comExtra = (colunas: SQL, valores: SQL) =>
      sql`insert into questionario_envios (tenant_id, patient_id, modelo_snapshot, origem, enviado_por, expira_em, ${colunas})
          values (${C.tenantId}, ${C.p}, ${SNAPSHOT}::jsonb, 'nutri', ${C.nutriId}, now() + interval '1 day', ${valores})`;
    await expect(em(C.ctx, comExtra(sql`situacao, respostas, respondido_em, respondido_via`, sql`'respondido', '{}', now(), 'app'`))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, comExtra(sql`situacao, cancelado_em, cancelado_por, cancelado_motivo`, sql`'cancelado', now(), ${C.nutriId}, 'nutri'`))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, comExtra(sql`situacao`, sql`'expirado'`))).rejects.toSatisfy(doGatilho);
    await expect(em(C.ctx, comExtra(sql`anamnese_id`, sql`${randomUUID()}`))).rejects.toSatisfy(doGatilho);
  });

  it('titular bloqueado, arquivado ou anonimizado → 42501 do gatilho, para a nutricionista e para o worker', async () => {
    const C = await cenario();
    const bloq = (await novoPaciente(app.db, C.ctx)).id;
    const arq = (await novoPaciente(app.db, C.ctx)).id;
    const anon = (await novoPaciente(app.db, C.ctx)).id;
    await bloquear(C, bloq);
    await arquivar(C, arq);
    await anonimizar(anon);
    for (const p of [bloq, arq, anon]) {
      await expect(em(C.ctx, envioDaNutri(C, { paciente: p })), p).rejects.toSatisfy(doGatilho);
      await expect(em(worker(C), insertAuto(C, p)), p).rejects.toSatisfy(doGatilho);
    }
    expect((await owner.pool.query('select count(*)::int as n from questionario_envios where tenant_id = $1', [C.tenantId])).rows[0].n).toBe(0);
  });
});

describe('Plano 27 — gatilho questionario_envios_regras: o paciente responde (RN-529)', () => {
  it('com login, pelo app: enviado → respondido, com respondido_em do relógio do banco (nunca o mandado); depois, nada muda', async () => {
    const C = await cenario();
    const pac = ctxPaciente(C.tenantId, C.p);
    const e = await enviar(C);
    const [r] = await atualizar(pac, e.id, sql`${RESPONDIDO_APP}, respondido_em = '2000-01-01T00:00:00Z'`);
    expect(r).toMatchObject({ situacao: 'respondido', respondido_via: 'app', respostas: { q1: 'Emagrecer' } });
    expect(Math.abs(new Date(r.respondido_em as string).getTime() - Date.now())).toBeLessThan(5 * 60_000);
    // as respostas nunca mudam depois (nem pelo paciente, nem pela equipe, nem pelo worker)
    await expect(atualizar(pac, e.id, sql`respostas = '{"q1":"Outra"}'::jsonb`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`respostas = '{"q1":"Outra"}'::jsonb`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, sql`respondido_via = 'link'`)).rejects.toSatisfy(doGatilho);
    await expect(dono(sql`update questionario_envios set respondido_em = now() where id = ${e.id}`)).rejects.toSatisfy(doGatilho);
    expect(await ler(e.id)).toMatchObject({ respostas: { q1: 'Emagrecer' }, respondido_via: 'app' });
  });

  it('sem login (semConta), pelo link: "link" passa e "app" → 42501; com login, "link" → 42501', async () => {
    const C = await cenario();
    const a = await enviar(C);
    const b = await enviar(C);
    await expect(atualizar(semConta(C, C.p), a.id, RESPONDIDO_APP)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(ctxPaciente(C.tenantId, C.p), b.id, RESPONDIDO_LINK)).rejects.toSatisfy(doGatilho);
    expect((await atualizar(semConta(C, C.p), a.id, RESPONDIDO_LINK))[0]).toMatchObject({ situacao: 'respondido', respondido_via: 'link' });
    expect((await atualizar(ctxPaciente(C.tenantId, C.p), b.id, RESPONDIDO_APP))[0]).toMatchObject({ situacao: 'respondido', respondido_via: 'app' });
  });

  it('depois de expira_em, em envio que não está aberto, ou mudando outra coluna (consulta, prazo, situação) → 42501', async () => {
    const C = await cenario();
    const pac = ctxPaciente(C.tenantId, C.p);
    const vencido = await enviar(C);
    await vencer(vencido.id);
    await expect(atualizar(pac, vencido.id, RESPONDIDO_APP)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(semConta(C, C.p), vencido.id, RESPONDIDO_LINK)).rejects.toSatisfy(doGatilho);

    const cancelado = await enviar(C);
    await atualizar(C.ctx, cancelado.id, cancelamento('nutri', C.nutriId));
    await expect(atualizar(pac, cancelado.id, RESPONDIDO_APP)).rejects.toSatisfy(doGatilho);

    const a = await consulta(C);
    const b = await consulta(C);
    const e = await enviar(C, { consulta: a });
    await expect(atualizar(pac, e.id, sql`${RESPONDIDO_APP}, appointment_id = ${b}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(pac, e.id, sql`appointment_id = ${b}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(pac, e.id, sql`${RESPONDIDO_APP}, expira_em = expira_em + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(pac, e.id, cancelamento('nutri', C.nutriId))).rejects.toSatisfy(doGatilho);
    await expect(atualizar(pac, e.id, sql`situacao = 'expirado'`)).rejects.toSatisfy(doGatilho);
    expect(await ler(e.id)).toMatchObject({ situacao: 'enviado', appointment_id: a });
  });

  it('titular bloqueado, arquivado ou anonimizado → 42501 (o gatilho relê o titular com FOR KEY SHARE)', async () => {
    for (const preparar of [(C: Cenario) => bloquear(C), (C: Cenario) => arquivar(C), (C: Cenario) => anonimizar(C.p)]) {
      const C = await cenario();
      const e = await enviar(C);
      await preparar(C);
      await expect(atualizar(ctxPaciente(C.tenantId, C.p), e.id, RESPONDIDO_APP)).rejects.toSatisfy(doGatilho);
      await expect(atualizar(semConta(C, C.p), e.id, RESPONDIDO_LINK)).rejects.toSatisfy(doGatilho);
    }
  });
});

describe('Plano 27 — gatilho questionario_envios_regras: a nutricionista (spec §9.2, RN-531, RN-536)', () => {
  it('cancela o envio aberto em nome próprio, pelo motivo "nutri"; outra autora, outro motivo ou envio fechado → 42501', async () => {
    const C = await cenario();
    const e = await enviar(C);
    await expect(atualizar(C.ctx, e.id, cancelamento('nutri', randomUUID()))).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, cancelamento('consulta_cancelada', C.nutriId))).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`${cancelamento('nutri', C.nutriId)}, expira_em = expira_em + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`situacao = 'expirado'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`expira_em = expira_em + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    const [c] = await atualizar(C.ctx, e.id, cancelamento('nutri', C.nutriId));
    expect(c).toMatchObject({ situacao: 'cancelado', cancelado_motivo: 'nutri', cancelado_por: C.nutriId });
    await expect(atualizar(C.ctx, e.id, sql`situacao = 'enviado', cancelado_em = null, cancelado_por = null, cancelado_motivo = null`)).rejects.toSatisfy(doGatilho);
    const r = await enviar(C);
    await responder(C, r.id);
    await expect(atualizar(C.ctx, r.id, cancelamento('nutri', C.nutriId))).rejects.toSatisfy(doGatilho);
  });

  it('"paciente_bloqueado" só com o titular já bloqueado', async () => {
    const C = await cenario();
    const e = await enviar(C);
    await expect(atualizar(C.ctx, e.id, cancelamento('paciente_bloqueado', C.nutriId))).rejects.toSatisfy(doGatilho);
    await bloquear(C);
    expect((await atualizar(C.ctx, e.id, cancelamento('paciente_bloqueado', C.nutriId)))[0]).toMatchObject({ situacao: 'cancelado', cancelado_motivo: 'paciente_bloqueado' });
  });

  it('liga a anamnese da cópia uma vez, de nulo para valor, só num respondido; troca, retirada ou outra coluna junto → 42501', async () => {
    const C = await cenario();
    const anamnese = async () =>
      (await em(C.ctx, sql`insert into anamneses (tenant_id, patient_id, template_snapshot, data) values (${C.tenantId}, ${C.p}, '{"nome":"Q","perguntas":[]}', '2026-11-20') returning id`))[0].id;
    const [a1, a2] = [await anamnese(), await anamnese()];
    const e = await enviar(C);
    await responder(C, e.id);
    await expect(atualizar(C.ctx, e.id, sql`anamnese_id = ${a1}, expira_em = expira_em + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    expect((await atualizar(C.ctx, e.id, sql`anamnese_id = ${a1}`))[0].anamnese_id).toBe(a1);
    await expect(atualizar(C.ctx, e.id, sql`anamnese_id = ${a2}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`anamnese_id = null`)).rejects.toSatisfy(doGatilho);
    // só a nutricionista liga a anamnese: o worker e o paciente não
    const outro = await enviar(C);
    await responder(C, outro.id);
    await expect(atualizar(worker(C), outro.id, sql`anamnese_id = ${a2}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(ctxPaciente(C.tenantId, C.p), outro.id, sql`anamnese_id = ${a2}`)).rejects.toSatisfy(doGatilho);
  });
});

describe('Plano 27 — gatilho questionario_envios_regras: o worker (RN-534, RN-535, QP-D59)', () => {
  it('expira: antes de expira_em e com a consulta no futuro → 42501; depois de expira_em, ou com a consulta já começada, passa', async () => {
    const C = await cenario();
    const avulso = await enviar(C);
    const a = await consulta(C);
    const daConsulta = await enviar(C, { consulta: a });
    const EXPIRAR = sql`situacao = 'expirado'`;
    await expect(atualizar(worker(C), avulso.id, EXPIRAR)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), daConsulta.id, EXPIRAR)).rejects.toSatisfy(doGatilho);
    await vencer(avulso.id);
    await expect(atualizar(C.ctx, avulso.id, EXPIRAR)).rejects.toSatisfy(doGatilho); // a nutricionista não expira
    await expect(atualizar(worker(C), avulso.id, sql`${EXPIRAR}, expira_em = now() + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    expect((await atualizar(worker(C), avulso.id, EXPIRAR))[0].situacao).toBe('expirado');
    // a consulta foi movida para antes (já começou) e o prazo ainda não venceu
    await moverConsulta(C, a, sql`now() - interval '2 hours'`);
    expect(((await ler(daConsulta.id)).expira_em as Date).getTime()).toBeGreaterThan(Date.now());
    expect((await atualizar(worker(C), daConsulta.id, EXPIRAR))[0].situacao).toBe('expirado');
    // o contexto vazio segue a mesma regra
    const outro = await enviar(C);
    await expect(dono(sql`update questionario_envios set situacao = 'expirado' where id = ${outro.id}`)).rejects.toSatisfy(doGatilho);
    await vencer(outro.id);
    await expect(dono(sql`update questionario_envios set situacao = 'expirado' where id = ${outro.id} returning id`)).resolves.toHaveLength(1);
  });

  it('cancela pela consulta cancelada (QP-D59): consulta agendada ou envio sem consulta → 42501; com a consulta cancelada, sem autora, passa', async () => {
    const C = await cenario();
    const a = await consulta(C);
    const e = await enviar(C, { consulta: a });
    const avulso = await enviar(C);
    const PELA_CONSULTA = cancelamento('consulta_cancelada', null);
    await expect(atualizar(worker(C), e.id, PELA_CONSULTA)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), avulso.id, PELA_CONSULTA)).rejects.toSatisfy(doGatilho);
    await cancelarConsulta(C, a);
    await expect(atualizar(worker(C), e.id, cancelamento('nutri', C.nutriId))).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, cancelamento('consulta_cancelada', C.nutriId))).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, cancelamento('paciente_bloqueado', null))).rejects.toSatisfy(doGatilho);
    const [c] = await atualizar(worker(C), e.id, PELA_CONSULTA);
    expect(c).toMatchObject({ situacao: 'cancelado', cancelado_motivo: 'consulta_cancelada', cancelado_por: null });
  });

  it('remarcação e consulta movida (RN-535): expira_em só para o início da consulta de NEW.appointment_id', async () => {
    const C = await cenario();
    const a = await consulta(C);
    const b = await consulta(C);
    const e = await enviar(C, { consulta: a });
    // remarcação (troca de consulta): o prazo vai para o início da nova
    await expect(atualizar(worker(C), e.id, sql`appointment_id = ${b}, expira_em = ${inicioDa(b)} + interval '1 hour'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, sql`appointment_id = ${b}`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, sql`appointment_id = null, expira_em = now() + interval '1 day'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(C.ctx, e.id, sql`appointment_id = ${b}, expira_em = ${inicioDa(b)}`)).rejects.toSatisfy(doGatilho); // a nutricionista não remarca
    const [r] = await atualizar(worker(C), e.id, sql`appointment_id = ${b}, expira_em = ${inicioDa(b)}`);
    expect(r.appointment_id).toBe(b);
    // a mesma consulta movida: realinha o prazo para o novo início, nunca para outro instante
    await moverConsulta(C, b, sql`inicio + interval '1 day'`);
    await expect(atualizar(worker(C), e.id, sql`expira_em = ${inicioDa(b)} - interval '1 minute'`)).rejects.toSatisfy(doGatilho);
    await expect(atualizar(worker(C), e.id, sql`expira_em = ${inicioDa(b)}, modelo_id = null, situacao = 'enviado'`)).resolves.toHaveLength(1);
    expect((await ler(e.id)).expira_em).toEqual((await owner.pool.query('select inicio from appointments where id = $1', [b])).rows[0].inicio);
    // fora de "enviado", nada de remarcação
    await responder(C, e.id);
    await moverConsulta(C, b, sql`inicio + interval '1 day'`);
    await expect(atualizar(worker(C), e.id, sql`expira_em = ${inicioDa(b)}`)).rejects.toSatisfy(doGatilho);
  });
});

describe('Plano 27 — gatilho questionario_envios_regras: QP-D35 e colunas fixas', () => {
  it('UPDATE sem mudança passa para nutri, worker, paciente (com e sem conta) e o contexto vazio', async () => {
    const C = await cenario();
    const e = await enviar(C);
    for (const ctx of [C.ctx, worker(C), ctxPaciente(C.tenantId, C.p), semConta(C, C.p)]) {
      expect(await atualizar(ctx, e.id, sql`situacao = situacao`), ctx.role).toHaveLength(1);
      expect(await atualizar(ctx, e.id, sql`updated_at = now()`), ctx.role).toHaveLength(1);
    }
    expect(await dono(sql`update questionario_envios set tenant_id = tenant_id where id = ${e.id} returning id`)).toHaveLength(1);
  });

  it('colunas fixas (snapshot, origem, autora, enviado_em, modelo, paciente, created_at) → 42501 do gatilho para a equipe, o worker e o contexto vazio', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const e = await enviar(C);
    const fixas = [
      sql`modelo_snapshot = '{"nome":"Outro","perguntas":[]}'::jsonb`,
      sql`origem = 'automatico', enviado_por = null`,
      sql`enviado_por = ${randomUUID()}`,
      sql`enviado_em = enviado_em - interval '1 hour'`,
      sql`modelo_id = ${randomUUID()}`,
      sql`patient_id = ${p2}`,
      sql`created_at = created_at - interval '1 hour'`,
      sql`id = ${randomUUID()}`,
    ];
    for (const set of fixas) {
      await expect(atualizar(C.ctx, e.id, set)).rejects.toSatisfy(doGatilho);
      await expect(atualizar(worker(C), e.id, set)).rejects.toSatisfy(doGatilho);
      await expect(dono(sql`update questionario_envios set ${set} where id = ${e.id}`)).rejects.toSatisfy(doGatilho);
    }
    // o contexto vazio não tem tenant na sessão: o tenant_id é coluna fixa para ele
    const D = await cenario();
    await expect(dono(sql`update questionario_envios set tenant_id = ${D.tenantId} where id = ${e.id}`)).rejects.toSatisfy(doGatilho);
    // tenant ou titular de fora da sessão: o gatilho devolve NEW e a RLS da própria tabela recusa (QP-D35)
    await expect(atualizar(C.ctx, e.id, sql`tenant_id = ${D.tenantId}`)).rejects.toSatisfy(rlsDe('questionario_envios'));
    await expect(atualizar(ctxPaciente(C.tenantId, C.p), e.id, sql`patient_id = ${p2}`)).rejects.toSatisfy(rlsDe('questionario_envios'));
    expect(await ler(e.id)).toMatchObject({ tenant_id: C.tenantId, patient_id: C.p, origem: 'nutri', enviado_por: C.nutriId });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Concorrência (QP-D33, RN-559): duas conexões; a ordem de travas paciente → envio → consulta não fecha ciclo (sem 40P01)
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
/** Espera a conexão `pid` ficar parada numa trava (até ~10 s). */
async function esperarTrava(pid: number) {
  for (let i = 0; i < 400; i++) {
    const { rows } = await owner.pool.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('a conexão não chegou a esperar a trava');
}
const capturar = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** O bloqueio pela equipe (atenderPedidoExclusao): trava o titular FOR UPDATE, bloqueia e cancela os envios abertos. */
const BLOQUEAR_E_CANCELAR = async (x: Conexao, C: Cenario) => {
  await x.c.query('select 1 from patients where id = $1 for update', [C.p]);
  await x.c.query(`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = $1`, [C.p]);
  return x.c.query(
    `update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = $2, cancelado_motivo = 'paciente_bloqueado'
      where patient_id = $1 and situacao = 'enviado'`,
    [C.p, C.nutriId],
  );
};
/** A resposta (responderQuestionario): trava o próprio titular FOR KEY SHARE ANTES do UPDATE (QP-D33). */
const TRAVAR_E_RESPONDER = async (x: Conexao, C: Cenario, id: unknown, via: 'app' | 'link') => {
  await x.c.query('select 1 from patients where id = $1 for key share', [C.p]);
  return x.c.query(`update questionario_envios set situacao = 'respondido', respostas = '{"q1":"x"}'::jsonb, respondido_via = $2 where id = $1`, [id, via]);
};

describe('Plano 27 — questionario_envios: concorrência com o bloqueio do titular (QP-D33, RN-559)', () => {
  const canais = [
    ['app', (C: Cenario) => ctxPaciente(C.tenantId, C.p)],
    ['link', (C: Cenario) => semConta(C, C.p)],
  ] as const;

  for (const [via, ctxDoPaciente] of canais) {
    it(`(a, ${via}) o bloqueio trava primeiro: a resposta espera e recebe 42501; o envio fica cancelado; nenhum 40P01`, async () => {
      const C = await cenario();
      const e = await enviar(C);
      const equipe = await abrir(C.ctx);
      const paciente = await abrir(ctxDoPaciente(C));
      try {
        expect((await BLOQUEAR_E_CANCELAR(equipe, C)).rowCount).toBe(1);
        const resposta = capturar(TRAVAR_E_RESPONDER(paciente, C, e.id, via));
        await esperarTrava(paciente.pid);
        await equipe.c.query('commit');
        expect(await resposta).toSatisfy(doGatilho);
      } finally {
        await fechar(equipe, paciente);
      }
      expect(await ler(e.id)).toMatchObject({ situacao: 'cancelado', cancelado_motivo: 'paciente_bloqueado', respostas: null });
    });

    it(`(a, ${via}) a resposta trava primeiro: o bloqueio espera, não cancela o respondido; nenhum 40P01`, async () => {
      const C = await cenario();
      const e = await enviar(C);
      const paciente = await abrir(ctxDoPaciente(C));
      const equipe = await abrir(C.ctx);
      try {
        expect((await TRAVAR_E_RESPONDER(paciente, C, e.id, via)).rowCount).toBe(1);
        const bloqueio = BLOQUEAR_E_CANCELAR(equipe, C).then((r) => r.rowCount, (err: unknown) => err);
        await esperarTrava(equipe.pid);
        await paciente.c.query('commit');
        expect(await bloqueio).toBe(0);
        await equipe.c.query('commit');
      } finally {
        await fechar(equipe, paciente);
      }
      expect(await ler(e.id)).toMatchObject({ situacao: 'respondido', respondido_via: via });
      expect((await owner.pool.query('select status from patients where id = $1', [C.p])).rows[0].status).toBe('bloqueado');
    });
  }

  it('(b) bloqueio em curso × INSERT do worker: o INSERT espera a trava do titular e recebe 42501; nenhum 40P01', async () => {
    const C = await cenario();
    const equipe = await abrir(C.ctx);
    const job = await abrir(worker(C));
    try {
      await BLOQUEAR_E_CANCELAR(equipe, C);
      const envio = capturar(
        job.c.query(`insert into questionario_envios (tenant_id, patient_id, modelo_snapshot, origem, expira_em) values ($1, $2, $3::jsonb, 'automatico', now() + interval '1 day')`, [
          C.tenantId,
          C.p,
          SNAPSHOT,
        ]),
      );
      await esperarTrava(job.pid);
      await equipe.c.query('commit');
      expect(await envio).toSatisfy(doGatilho);
    } finally {
      await fechar(equipe, job);
    }
    expect((await owner.pool.query('select count(*)::int as n from questionario_envios where patient_id = $1', [C.p])).rows[0].n).toBe(0);
  });
});
