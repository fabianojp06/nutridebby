import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 27 (spec §9.1, §9.2): `anamnesis_templates` (finalidade, envio automático, staff_only) e `questionario_envios` no
 * banco — RLS, CHECKs, índices, FKs, REVOKE e auditoria. Tudo por SQL cru, sem o módulo: é o que o banco garante sozinho.
 * T1a: só o que não depende do gatilho questionario_envios_regras (as transições por papel e a concorrência são da T1b).
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
    const ins = (colunas: SQL, valores: SQL) =>
      em(C.ctx, sql`insert into questionario_envios (tenant_id, patient_id, ${colunas}) values (${C.tenantId}, ${C.p}, ${valores})`);
    await expect(ins(sql`modelo_snapshot, origem, expira_em`, sql`${SNAPSHOT}::jsonb, 'nutri', now() + interval '1 day'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'automatico', ${C.nutriId}, now() + interval '1 day'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'outra', ${C.nutriId}, now() + interval '1 day'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`${SNAPSHOT}::jsonb, 'nutri', ${C.nutriId}, now() - interval '1 day'`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins(sql`modelo_snapshot, origem, enviado_por, expira_em`, sql`'[]'::jsonb, 'nutri', ${C.nutriId}, now() + interval '1 day'`)).rejects.toSatisfy(comCodigo('23514'));
    const e = await enviar(C);
    await expect(em(C.ctx, sql`update questionario_envios set situacao = 'aberto' where id = ${e.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(
      em(ctxPaciente(C.tenantId, C.p), sql`update questionario_envios set situacao = 'respondido', respostas = '{}'::jsonb, respondido_via = 'whatsapp', respondido_em = now() where id = ${e.id}`),
    ).rejects.toSatisfy(comCodigo('23514'));
    await expect(
      em(C.ctx, sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId}, cancelado_motivo = 'outro' where id = ${e.id}`),
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
    await expect(
      em(C.ctx, sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_por = ${C.nutriId} where id = ${e.id}`),
    ).rejects.toSatisfy(comCodigo('23514'));
    await expect(
      em(C.ctx, sql`update questionario_envios set situacao = 'cancelado', cancelado_em = now(), cancelado_motivo = 'nutri' where id = ${e.id}`),
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
    // 23514 do CHECK (T1b: o gatilho pode recusar antes, com 42501)
    await expect(em(C.ctx, sql`update questionario_envios set anamnese_id = ${daP1} where id = ${aberto.id}`)).rejects.toSatisfy(comCodigo('23514', '42501'));
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
