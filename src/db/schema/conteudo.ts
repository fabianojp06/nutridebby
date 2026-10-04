import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { foods } from './alimentos';
import { patients, patientTags } from './pacientes';
import { storedFiles, tenants } from './platform';

/**
 * M6 (US-050 a US-056). `etiquetas` = rótulos DO CONTEÚDO ("sem lactose": filtro do feed, visíveis ao paciente); a
 * audiência por etiqueta DE PACIENTE ("gestante", staff_only) fica em content_audience.tag_id (D1). A sessão de
 * paciente só vê o publicado da audiência dela (política paciente_conteudo_visivel, migration 0083, D2).
 * `video_id`: YouTube = 11 caracteres; Vimeo = número, ou "número/hash" do vídeo não listado (D10).
 */
export const contents = pgTable(
  'contents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipo: text('tipo').notNull(),
    titulo: text('titulo').notNull(),
    resumo: text('resumo').notNull().default(''),
    corpoMd: text('corpo_md').notNull().default(''),
    videoProvider: text('video_provider'),
    videoId: text('video_id'),
    /** JPEG convertido (D8): upload da receita/orientação ou miniatura do oEmbed (vídeo, D9). */
    capaPath: text('capa_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    /** Só orientação (US-052). */
    pdfPath: text('pdf_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    etiquetas: text('etiquetas').array().notNull().default(sql`'{}'::text[]`),
    visibilidade: text('visibilidade').notNull().default('todos'),
    status: text('status').notNull().default('rascunho'),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('contents_tipo_valido', sql`${t.tipo} in ('video', 'receita', 'orientacao')`),
    check('contents_visibilidade_valida', sql`${t.visibilidade} in ('todos', 'etiquetas', 'pacientes')`),
    check('contents_status_valido', sql`${t.status} in ('rascunho', 'publicado')`),
    check('contents_publicado_em', sql`(${t.status} = 'publicado') = (${t.publicadoEm} is not null)`),
    check('contents_textos_tamanho', sql`char_length(${t.titulo}) between 1 and 120 and char_length(${t.resumo}) <= 300 and char_length(${t.corpoMd}) <= 20000`),
    // o tamanho de cada etiqueta (1–30) é o CHECK contents_etiqueta_tamanho, na migration 0082 (precisa de função)
    check('contents_etiquetas_tamanho', sql`cardinality(${t.etiquetas}) <= 10`),
    check(
      'contents_video_completo',
      sql`(${t.videoProvider} is null) = (${t.videoId} is null) and (${t.tipo} <> 'video' or ${t.videoId} is not null) and (${t.tipo} <> 'orientacao' or ${t.videoId} is null)`,
    ),
    check(
      'contents_video_id_valido',
      sql`${t.videoId} is null or (${t.videoProvider} = 'youtube' and ${t.videoId} ~ '^[A-Za-z0-9_-]{11}$') or (${t.videoProvider} = 'vimeo' and ${t.videoId} ~ '^[0-9]{6,12}(/[0-9a-f]{6,20})?$')`,
    ),
    check('contents_pdf_so_orientacao', sql`${t.pdfPath} is null or ${t.tipo} = 'orientacao'`),
    check('contents_capa_do_tenant', sql`${t.capaPath} is null or ${t.capaPath} like ${t.tenantId}::text || '/capa/%'`),
    check('contents_pdf_do_tenant', sql`${t.pdfPath} is null or ${t.pdfPath} like ${t.tenantId}::text || '/orientacao_pdf/%'`),
    unique('contents_tenant_id_unique').on(t.tenantId, t.id),
    // US-055: feed do mais recente; D19: filtro por etiqueta do conteúdo e busca full-text em título + resumo
    index('contents_feed_idx').on(t.tenantId, t.status, t.publicadoEm.desc()),
    index('contents_etiquetas_idx').using('gin', t.etiquetas),
    index('contents_busca_idx').using('gin', sql`to_tsvector('portuguese', app_unaccent(${t.titulo} || ' ' || ${t.resumo}))`),
  ],
);

export type ContentRow = typeof contents.$inferSelect;

/** US-051 / RN-11: 1:1 com o conteúdo do tipo receita (a chave é o próprio content_id). */
export const recipes = pgTable(
  'recipes',
  {
    contentId: uuid('content_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    rendimentoTotalG: numeric('rendimento_total_g', { precision: 7, scale: 1, mode: 'number' }).notNull(),
    porcaoG: numeric('porcao_g', { precision: 7, scale: 1, mode: 'number' }).notNull(),
    tempoPreparoMin: smallint('tempo_preparo_min'),
    modoPreparoMd: text('modo_preparo_md').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('recipes_rendimento_faixa', sql`${t.rendimentoTotalG} > 0 and ${t.rendimentoTotalG} <= 20000`),
    check('recipes_porcao_valida', sql`${t.porcaoG} > 0 and ${t.porcaoG} <= ${t.rendimentoTotalG}`),
    check('recipes_tempo_faixa', sql`${t.tempoPreparoMin} is null or ${t.tempoPreparoMin} between 1 and 1440`),
    check('recipes_modo_tamanho', sql`char_length(${t.modoPreparoMd}) <= 10000`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'recipes_conteudo_fk' }).onDelete('cascade'),
    unique('recipes_tenant_conteudo_unique').on(t.tenantId, t.contentId),
  ],
);

export type RecipeRow = typeof recipes.$inferSelect;

/** D12: gramas + medida caseira em texto livre. FK RESTRICT para foods, como meal_items (alimento em uso não sai). */
export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: numeric('quantidade_g', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    medidaCaseiraTxt: text('medida_caseira_txt'),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('recipe_ingredients_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    check('recipe_ingredients_medida_tamanho', sql`${t.medidaCaseiraTxt} is null or char_length(${t.medidaCaseiraTxt}) between 1 and 60`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [recipes.tenantId, recipes.contentId], name: 'recipe_ingredients_receita_fk' }).onDelete('cascade'),
    index('recipe_ingredients_receita_idx').on(t.tenantId, t.contentId, t.ordem),
    index('recipe_ingredients_alimento_idx').on(t.foodId),
  ],
);

export type RecipeIngredientRow = typeof recipeIngredients.$inferSelect;

/** US-053 / RN-12: alvo de um conteúdo "etiquetas" (tag_id) ou "pacientes" (patient_id) — exatamente um dos dois. */
export const contentAudience = pgTable(
  'content_audience',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id'),
    tagId: uuid('tag_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('content_audience_um_alvo', sql`(${t.patientId} is null) <> (${t.tagId} is null)`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_audience_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_audience_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [patientTags.tenantId, patientTags.id], name: 'content_audience_etiqueta_fk' }).onDelete('cascade'),
    unique('content_audience_paciente_unique').on(t.contentId, t.patientId),
    unique('content_audience_etiqueta_unique').on(t.contentId, t.tagId),
    index('content_audience_paciente_idx').on(t.tenantId, t.patientId),
    index('content_audience_etiqueta_idx').on(t.tenantId, t.tagId),
  ],
);

/** US-055: uma linha por (conteúdo, paciente) — conta pacientes únicos (US-056). */
export const contentViews = pgTable(
  'content_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    vistoEm: timestamp('visto_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('content_views_unique').on(t.contentId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_views_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_views_paciente_fk' }),
    index('content_views_paciente_idx').on(t.tenantId, t.patientId),
  ],
);

export const contentFavorites = pgTable(
  'content_favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('content_favorites_unique').on(t.contentId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_favorites_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_favorites_paciente_fk' }),
    index('content_favorites_paciente_idx').on(t.tenantId, t.patientId),
  ],
);
