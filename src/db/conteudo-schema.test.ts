import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
const restricao = (nome: string) => (e: unknown) => causa(e).constraint === nome;
const umId = (r: { rows: unknown[] }) => (r.rows[0] as { id: string }).id;

describe('tabelas de conteúdo (§7, Plano 07)', () => {
  it('CHECKs: vídeo sem id ou com id fora do formato, publicado sem data, etiqueta vazia, longa ou em excesso, porção maior que o rendimento, público sem alvo ou com os dois', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'video', 'Sem link')`)).rejects.toSatisfy(restricao('contents_video_completo'));
    await expect(
      q(sql`insert into contents (tenant_id, tipo, titulo, video_provider, video_id) values (${T.tenantId}, 'video', 'X', 'youtube', '"><script>x')`),
    ).rejects.toSatisfy(restricao('contents_video_id_valido'));
    await expect(q(sql`insert into contents (tenant_id, tipo, titulo, status) values (${T.tenantId}, 'orientacao', 'X', 'publicado')`)).rejects.toSatisfy(restricao('contents_publicado_em'));
    const comEtiquetas = (etiquetas: (string | null)[]) => q(sql`insert into contents (tenant_id, tipo, titulo, etiquetas) values (${T.tenantId}, 'orientacao', 'X', array[${sql.join(etiquetas.map((e) => sql`${e}`), sql`, `)}]::text[])`);
    await expect(comEtiquetas(['sem lactose', 'x'.repeat(31)])).rejects.toSatisfy(restricao('contents_etiqueta_tamanho'));
    await expect(comEtiquetas(['sem lactose', ''])).rejects.toSatisfy(restricao('contents_etiqueta_tamanho'));
    await expect(comEtiquetas([null])).rejects.toSatisfy(restricao('contents_etiqueta_tamanho'));
    await expect(comEtiquetas(Array.from({ length: 11 }, (_, i) => `e${i}`))).rejects.toSatisfy(restricao('contents_etiquetas_tamanho'));
    await comEtiquetas(['x'.repeat(30), 'café da manhã']); // 30 caracteres vale
    await comEtiquetas([]); // sem etiquetas vale
    const id = umId(await q(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'receita', 'Panqueca de aveia') returning id`));
    await expect(q(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 1200)`)).rejects.toSatisfy(restricao('recipes_porcao_valida'));
    await q(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 1000)`); // porção = rendimento vale
    await expect(q(sql`insert into content_audience (tenant_id, content_id) values (${T.tenantId}, ${id})`)).rejects.toSatisfy(restricao('content_audience_um_alvo'));
    const tag = umId(await q(sql`insert into patient_tags (tenant_id, nome) values (${T.tenantId}, 'gestante') returning id`));
    await expect(
      q(sql`insert into content_audience (tenant_id, content_id, patient_id, tag_id) values (${T.tenantId}, ${id}, ${p.id}, ${tag})`),
    ).rejects.toSatisfy(restricao('content_audience_um_alvo'));
  });

  it('uma visualização e um favorito por paciente e conteúdo (US-055)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    const id = umId(await q(sql`insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${T.tenantId}, 'orientacao', 'Rótulos', 'publicado', now()) returning id`));
    await q(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`);
    await expect(q(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`)).rejects.toSatisfy(restricao('content_views_unique'));
    await q(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`);
    await expect(q(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`)).rejects.toSatisfy(restricao('content_favorites_unique'));
  });

  it('D13: a refeição só aponta para receita do mesmo tenant; excluir o conteúdo solta a sugestão (SET NULL só na coluna)', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const deT = umId(await withTenant(T.ctx, (tx) => tx.execute(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'receita', 'Panqueca') returning id`), app.db));
    const deU = umId(await withTenant(U.ctx, (tx) => tx.execute(sql`insert into contents (tenant_id, tipo, titulo) values (${U.tenantId}, 'receita', 'Bolo') returning id`), app.db));
    const meal = crypto.randomUUID();
    await withTenant(
      T.ctx,
      async (tx) => {
        const plano = umId(await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo) values (${T.tenantId}, ${p.id}, 'Plano') returning id`));
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem, recipe_content_id) values (${meal}, ${T.tenantId}, ${p.id}, ${plano}, 'Café da manhã', 0, ${deT})`);
      },
      app.db,
    );
    await expect(
      withTenant(T.ctx, (tx) => tx.execute(sql`update meals set recipe_content_id = ${deU} where id = ${meal}`), app.db),
    ).rejects.toSatisfy(restricao('meals_receita_fk'));
    await withTenant(T.ctx, (tx) => tx.execute(sql`delete from contents where id = ${deT}`), app.db);
    const [m] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select tenant_id, recipe_content_id from meals where id = ${meal}`), app.db)).rows;
    expect(m).toEqual({ tenant_id: T.tenantId, recipe_content_id: null }); // o tenant_id (NOT NULL) fica
  });
});
