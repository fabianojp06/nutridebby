import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 27 (spec §9.3): `recordatorios` e `recordatorio_itens` no banco — RLS, CHECKs, FKs, REVOKE e auditoria. Tudo por
 * SQL cru, sem o módulo. T1a: só o que não depende dos gatilhos recordatorios_regras e recordatorio_itens_colunas_fixas
 * (criado_por pelo gatilho, worker recusado e colunas fixas são da T1b).
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

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return { code: x.code ?? x.cause?.code, message: x.cause?.message ?? x.message ?? '' };
};
const rlsDe = (tabela: string) => (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /row-level security/.test(message) && message.includes(`for table "${tabela}"`);
};
const permissaoNegada = (e: unknown) => {
  const { code, message } = erro(e);
  return code === '42501' && /permission denied/.test(message);
};
const comCodigo = (codigo: string) => (e: unknown) => erro(e).code === codigo;

type Cenario = TenantDeTeste & { p: string };
async function cenario(): Promise<Cenario> {
  const T = await novoTenant(app.db);
  return { ...T, p: (await novoPaciente(app.db, T.ctx)).id };
}

const novoRecordatorio = (C: Cenario, paciente = C.p) =>
  sql`insert into recordatorios (tenant_id, patient_id, dia_relatado, criado_por) values (${C.tenantId}, ${paciente}, '2026-11-20', ${C.nutriId}) returning *`;
const recordatorio = async (C: Cenario, paciente = C.p) => (await em(C.ctx, novoRecordatorio(C, paciente)))[0];

type Item = Partial<Record<'refeicao' | 'refeicao_nome' | 'food_id' | 'alimento_nome' | 'descricao' | 'local', string | null> & { quantidade_g: number | null }>;
/** Item com alimento (padrão) ou o que `x` sobrescrever. */
const novoItem = (C: Cenario, recordatorioId: unknown, x: Item = {}, paciente = C.p) => {
  const i = { refeicao: 'Almoço', refeicao_nome: null, food_id: null, alimento_nome: 'Arroz branco cozido', quantidade_g: 100, descricao: null, local: null, ...x };
  return sql`insert into recordatorio_itens (id, tenant_id, patient_id, recordatorio_id, refeicao, refeicao_nome, food_id, alimento_nome, quantidade_g, descricao, local, ordem)
    values (${randomUUID()}, ${C.tenantId}, ${paciente}, ${recordatorioId}, ${i.refeicao}, ${i.refeicao_nome}, ${i.food_id}, ${i.alimento_nome}, ${i.quantidade_g}, ${i.descricao}, ${i.local}, 0)
    returning *`;
};

describe('Plano 27 — recordatorios e recordatorio_itens no banco (spec §9.3)', () => {
  it('a nutricionista grava o recordatório e os itens; o paciente lê os próprios e não grava', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const r = await recordatorio(C);
    const [i] = await em(C.ctx, novoItem(C, r.id));
    const pac = ctxPaciente(C.tenantId, C.p);
    expect((await em(pac, sql`select id from recordatorios`)).map((x) => x.id)).toEqual([r.id]);
    expect((await em(pac, sql`select id from recordatorio_itens`)).map((x) => x.id)).toEqual([i.id]);
    expect(await em(ctxPaciente(C.tenantId, p2), sql`select 1 from recordatorios`)).toEqual([]);
    expect(await em(ctxPaciente(C.tenantId, p2), sql`select 1 from recordatorio_itens`)).toEqual([]);
    // sem escrita do paciente: INSERT pela RLS; UPDATE e DELETE de item dão 0 linhas
    await expect(em(pac, novoRecordatorio(C))).rejects.toSatisfy(rlsDe('recordatorios'));
    await expect(em(pac, novoItem(C, r.id))).rejects.toSatisfy(rlsDe('recordatorio_itens'));
    expect(await em(pac, sql`update recordatorios set dia_atipico = true returning id`)).toEqual([]);
    expect(await em(pac, sql`update recordatorio_itens set ordem = 1 returning id`)).toEqual([]);
    expect(await em(pac, sql`delete from recordatorio_itens returning id`)).toEqual([]);
  });

  it('publico e outro tenant não leem nem gravam (RLS)', async () => {
    const C = await cenario();
    const D = await cenario();
    const r = await recordatorio(C);
    await em(C.ctx, novoItem(C, r.id));
    for (const ctx of [publico(C), D.ctx]) {
      expect(await em(ctx, sql`select 1 from recordatorios`)).toEqual([]);
      expect(await em(ctx, sql`select 1 from recordatorio_itens`)).toEqual([]);
      await expect(em(ctx, novoRecordatorio(C))).rejects.toSatisfy(rlsDe('recordatorios'));
      await expect(em(ctx, novoItem(C, r.id))).rejects.toSatisfy(rlsDe('recordatorio_itens'));
    }
  });

  it('CHECKs: tipo do item, refeição da lista, nome só com "Outro", quantidade 0,1–5.000, tamanhos e observação', async () => {
    const C = await cenario();
    const r = await recordatorio(C);
    const falha = (x: Item) => expect(em(C.ctx, novoItem(C, r.id, x))).rejects.toSatisfy(comCodigo('23514'));
    // tipo: com alimento exige nome e quantidade; sem cadastro, só a descrição
    await falha({ quantidade_g: null });
    await falha({ alimento_nome: null, quantidade_g: null });
    await falha({ alimento_nome: null, quantidade_g: null, descricao: 'Pão de queijo', food_id: '00000000-0000-4000-8000-000000000003' });
    await falha({ alimento_nome: null, descricao: 'Pão de queijo' });
    await expect(em(C.ctx, novoItem(C, r.id, { alimento_nome: null, quantidade_g: null, descricao: 'Pão de queijo caseiro' }))).resolves.toHaveLength(1);
    await expect(em(C.ctx, novoItem(C, r.id, { food_id: '00000000-0000-4000-8000-000000000003', descricao: 'Cozido sem sal' }))).resolves.toHaveLength(1);
    // refeição
    await falha({ refeicao: 'Brunch' });
    await falha({ refeicao: 'Outro' });
    await falha({ refeicao: 'Almoço', refeicao_nome: 'Brunch' });
    await falha({ refeicao: 'Outro', refeicao_nome: 'B' });
    await falha({ refeicao: 'Outro', refeicao_nome: 'x'.repeat(41) });
    await expect(em(C.ctx, novoItem(C, r.id, { refeicao: 'Outro', refeicao_nome: 'Pré-treino' }))).resolves.toHaveLength(1);
    // quantidade
    await falha({ quantidade_g: 0.05 });
    await falha({ quantidade_g: 5000.01 });
    await expect(em(C.ctx, novoItem(C, r.id, { quantidade_g: 5000 }))).resolves.toHaveLength(1);
    // tamanhos
    await falha({ local: 'C' });
    await falha({ alimento_nome: 'A' });
    await falha({ alimento_nome: null, quantidade_g: null, descricao: 'P' });
    await falha({ alimento_nome: null, quantidade_g: null, descricao: 'x'.repeat(121) });
    await falha({ descricao: 'x'.repeat(201) });
    await expect(em(C.ctx, novoItem(C, r.id, { descricao: 'x'.repeat(200) }))).resolves.toHaveLength(1);
    await expect(em(C.ctx, sql`update recordatorios set observacao = '' where id = ${r.id}`)).rejects.toSatisfy(comCodigo('23514'));
    await expect(em(C.ctx, sql`update recordatorios set observacao = ${'x'.repeat(2001)} where id = ${r.id}`)).rejects.toSatisfy(comCodigo('23514'));
  });

  it('FK composta: o item não aponta para o recordatório de outro paciente (23503)', async () => {
    const C = await cenario();
    const p2 = (await novoPaciente(app.db, C.ctx)).id;
    const deP2 = await recordatorio(C, p2);
    await expect(em(C.ctx, novoItem(C, deP2.id))).rejects.toSatisfy(comCodigo('23503'));
  });

  it('food_id RESTRICT: o "Meu alimento" usado num recordatório não se exclui (23503)', async () => {
    const C = await cenario();
    const [f] = await em(
      C.ctx,
      sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${C.tenantId}, 'Bolo da vó', 'Miscelâneas', 300, 5, 40, 12, 1) returning id`,
    );
    const r = await recordatorio(C);
    await em(C.ctx, novoItem(C, r.id, { food_id: f.id as string, alimento_nome: 'Bolo da vó' }));
    await expect(em(C.ctx, sql`delete from foods where id = ${f.id}`)).rejects.toSatisfy(comCodigo('23503'));
  });

  it('recordatorios: DELETE e TRUNCATE revogados (42501 de permissão); o item a nutricionista apaga, com o excluir auditado como recordatorio_item', async () => {
    const C = await cenario();
    const r = await recordatorio(C);
    const [i] = await em(C.ctx, novoItem(C, r.id));
    await expect(em(C.ctx, sql`delete from recordatorios`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(C.ctx, sql`truncate recordatorios`)).rejects.toSatisfy(permissaoNegada);
    await expect(em(ctxPaciente(C.tenantId, C.p), sql`delete from recordatorios`)).rejects.toSatisfy(permissaoNegada);
    expect(await em(C.ctx, sql`delete from recordatorio_itens where id = ${i.id} returning id`)).toHaveLength(1);
    const { rows } = await owner.pool.query('select * from audit_log where entidade_id = $1 order by criado_em', [i.id]);
    expect(rows.map((x) => [x.acao, x.entidade, x.actor_user_id, x.patient_id])).toEqual([
      ['criar', 'recordatorio_item', C.nutriId, C.p],
      ['excluir', 'recordatorio_item', C.nutriId, C.p],
    ]);
  });

  it('auditoria do recordatório: entidade "recordatorio", sem o conteúdo', async () => {
    const C = await cenario();
    const marca = `MARCA-${randomUUID()}`;
    const r = await recordatorio(C);
    await em(C.ctx, sql`update recordatorios set observacao = ${marca} where id = ${r.id}`);
    await em(C.ctx, novoItem(C, r.id, { alimento_nome: marca }));
    const { rows } = await owner.pool.query('select * from audit_log where entidade_id = $1 order by criado_em', [r.id]);
    expect(rows.map((x) => [x.acao, x.entidade, x.actor_user_id, x.patient_id])).toEqual([
      ['criar', 'recordatorio', C.nutriId, C.p],
      ['alterar', 'recordatorio', C.nutriId, C.p],
    ]);
    const todas = await owner.pool.query('select * from audit_log where tenant_id = $1', [C.tenantId]);
    expect(JSON.stringify(todas.rows)).not.toContain(marca);
  });
});
