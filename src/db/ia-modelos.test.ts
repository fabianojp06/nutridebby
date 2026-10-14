import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { geracaoNoBanco } from '../../test/ia';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const semPermissao = (e: unknown) => causa(e).code === '42501' && /permission denied/.test(String(causa(e).message));
const violaRls = (e: unknown) => causa(e).code === '42501' && /row-level security/.test(String(causa(e).message));
const violaCheck = (nome: string) => (e: unknown) => causa(e).code === '23514' && causa(e).constraint === nome;
const violaUnico = (nome: string) => (e: unknown) => causa(e).code === '23505' && causa(e).constraint === nome;
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario() {
  const T = await novoTenant(app.db);
  const q = (s: SQL, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, q };
}

describe('0111/0112: ia_geracoes_modelos (US-123 (d), RNF-102)', () => {
  it('um pacote em andamento por consultório (RN-103); falhou/pronta não contam', async () => {
    const { T } = await cenario();
    await geracaoNoBanco(app.db, T.ctx, { status: 'falhou', erro: 'interrompida' });
    await geracaoNoBanco(app.db, T.ctx);
    await expect(geracaoNoBanco(app.db, T.ctx, { area: 'gestacao', status: 'processando' })).rejects.toSatisfy(violaUnico('ia_geracoes_modelos_em_andamento_idx'));
  });

  it('CHECKs: área da lista, erro só em falhou, descartados ≥ 0', async () => {
    const { T } = await cenario();
    await expect(geracaoNoBanco(app.db, T.ctx, { area: 'infantil' })).rejects.toSatisfy(violaCheck('ia_geracoes_modelos_area_valida'));
    await expect(geracaoNoBanco(app.db, T.ctx, { status: 'falhou' })).rejects.toSatisfy(violaCheck('ia_geracoes_modelos_erro_so_falhou'));
    await expect(geracaoNoBanco(app.db, T.ctx, { status: 'pronta', itensDescartados: -1 })).rejects.toSatisfy(violaCheck('ia_geracoes_modelos_descartados_valido'));
  });

  it('colunas fixas (tenant, área, quem pediu, modelo, versão, criado_em) e DELETE/TRUNCATE revogados', async () => {
    const { T, q } = await cenario();
    const id = await geracaoNoBanco(app.db, T.ctx);
    await expect(q(sql`update ia_geracoes_modelos set area = 'idosos' where id = ${id}`)).rejects.toSatisfy(negadoPor('coluna fixa da geração de modelos'));
    await expect(q(sql`update ia_geracoes_modelos set modelo = 'claude-opus-5-5' where id = ${id}`)).rejects.toSatisfy(negadoPor('coluna fixa da geração de modelos'));
    await q(sql`update ia_geracoes_modelos set status = 'processando', iniciado_em = now() where id = ${id}`); // situação muda
    await expect(q(sql`delete from ia_geracoes_modelos where id = ${id}`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
  });

  it('staff_only: a sessão de paciente não vê nem grava', async () => {
    const { T } = await cenario();
    await geracaoNoBanco(app.db, T.ctx, { status: 'pronta' });
    const p = await novoPaciente(app.db, T.ctx);
    const comoPaciente = ctxPaciente(T.tenantId, p.id);
    const r = await withTenant(comoPaciente, (tx) => tx.execute(sql`select id from ia_geracoes_modelos`), app.db);
    expect(r.rows).toEqual([]);
    await expect(geracaoNoBanco(app.db, comoPaciente)).rejects.toSatisfy(violaRls);
  });
});

describe('0112: origem IA e aprovação dos modelos (gatilho app_modelo_ia_origem, §5.11 item 9, RN-125)', () => {
  const plano = (t: string, geracao: string | null, extra: SQL = sql``) =>
    sql`insert into meal_plans (tenant_id, is_template, titulo, ia_geracao_id ${extra}) values (${t}, true, 'Modelo', ${geracao}) returning id`;

  it('só o worker cria modelo com origem IA; nasce sem aprovação', async () => {
    const { T, q } = await cenario();
    const g = await geracaoNoBanco(app.db, T.ctx, { status: 'pronta' });
    await expect(q(plano(T.tenantId, g))).rejects.toSatisfy(negadoPor('origem IA só pelo worker'));
    await expect(
      q(sql`insert into meal_plans (tenant_id, is_template, titulo, ia_geracao_id, aprovado_em, aprovado_por) values (${T.tenantId}, true, 'M', ${g}, now(), ${T.nutriId})`, worker(T.tenantId)),
    ).rejects.toSatisfy(negadoPor('modelo da IA nasce sem aprovação'));
    const [m] = (await q(plano(T.tenantId, g), worker(T.tenantId))).rows as { id: string }[];
    expect(m.id).toBeTruthy();
  });

  it('a origem não muda; a aprovação vai de nula a preenchida uma vez, em nome da usuária da sessão', async () => {
    const { T, q } = await cenario();
    const g = await geracaoNoBanco(app.db, T.ctx, { status: 'pronta' });
    const [m] = (await q(plano(T.tenantId, g), worker(T.tenantId))).rows as { id: string }[];
    await expect(q(sql`update meal_plans set ia_geracao_id = null where id = ${m.id}`)).rejects.toSatisfy(negadoPor('a origem IA do modelo não muda'));
    await expect(q(sql`update meal_plans set aprovado_em = now(), aprovado_por = ${randomUUID()} where id = ${m.id}`)).rejects.toSatisfy(negadoPor('quem aprova é a usuária da sessão'));
    await q(sql`update meal_plans set aprovado_em = now(), aprovado_por = ${T.nutriId} where id = ${m.id}`);
    await expect(q(sql`update meal_plans set aprovado_em = now() - interval '1 day' where id = ${m.id}`)).rejects.toSatisfy(negadoPor('a aprovação do modelo não muda'));
    await q(sql`update meal_plans set titulo = 'Editado depois de aprovado' where id = ${m.id}`); // RN-125: editar é livre
  });

  it('CHECKs: origem só em modelo; aprovação só com origem e com quem/quando juntos; padrão de anamnese só aprovado', async () => {
    const { T, q } = await cenario();
    const g = await geracaoNoBanco(app.db, T.ctx, { status: 'pronta' });
    const p = await novoPaciente(app.db, T.ctx);
    await expect(
      q(sql`insert into meal_plans (tenant_id, patient_id, is_template, titulo, ia_geracao_id) values (${T.tenantId}, ${p.id}, false, 'P', ${g})`, worker(T.tenantId)),
    ).rejects.toSatisfy(violaCheck('meal_plans_ia_geracao_so_modelo'));
    await expect(
      q(sql`insert into meal_plans (tenant_id, is_template, titulo, aprovado_em, aprovado_por) values (${T.tenantId}, true, 'M', now(), ${T.nutriId})`),
    ).rejects.toSatisfy(violaCheck('meal_plans_aprovacao_coerente'));
    await expect(
      q(sql`insert into anamnesis_templates (tenant_id, nome, schema, padrao, ia_geracao_id) values (${T.tenantId}, 'A', '{"perguntas":[]}', true, ${g})`, worker(T.tenantId)),
    ).rejects.toSatisfy(violaCheck('anamnesis_templates_padrao_aprovado'));
  });

  it('FK composta: a origem é uma geração do mesmo consultório', async () => {
    const { q, T } = await cenario();
    const outro = await novoTenant(app.db);
    const g = await geracaoNoBanco(app.db, outro.ctx, { status: 'pronta' });
    await expect(q(plano(T.tenantId, g), worker(T.tenantId))).rejects.toSatisfy((e: unknown) => causa(e).code === '23503');
  });
});
