import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { TIPOS_DE_REFEICAO } from '../../modules/plano-alimentar/tipos-de-refeicao'; // relativo: o drizzle-kit não resolve o alias @/
import { foods } from './alimentos';
import type { MedidaDoItem } from './plano-alimentar';
import { tenants } from './platform';

/**
 * Plano 19 (spec §4.5, §9.2): biblioteca do consultório — perfis de referência, "Minhas refeições" e listas de
 * substituição. Sem paciente: as seis tabelas são `staff_only` (o paciente nunca vê, nem pela API) e sem gatilho de
 * auditoria (não são dado de saúde). O que o paciente vê do plano é a cópia: `referencia_congelada` em `meal_plans` e
 * `plano_listas_substituicao` (src/db/schema/plano-alimentar.ts).
 */

const listaSql = (vs: readonly string[]) => sql.raw(vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));
const gramas = (nome: string) => numeric(nome, { precision: 7, scale: 2, mode: 'number' });

/** RN-238: por chave do catálogo de nutrientes, a meta e/ou o máximo (conferidos no código). */
export type ValoresDaReferencia = Record<string, { meta?: number | null; maximo?: number | null }>;

/** RN-238 (US-232): perfil de referência do consultório. `UNIQUE (tenant_id, id)` é o alvo da FK composta de `meal_plans`. */
export const referenciasNutrientes = pgTable(
  'referencias_nutrientes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    nome: text('nome').notNull(),
    /** Obrigatória (RN-238): de onde vêm os valores (ex.: "DRI 2019"). */
    fonte: text('fonte').notNull(),
    valores: jsonb('valores').$type<ValoresDaReferencia>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('referencias_nutrientes_tenant_id_unique').on(t.tenantId, t.id),
    unique('referencias_nutrientes_nome_unique').on(t.tenantId, t.nome),
    check('referencias_nutrientes_textos_tamanho', sql`char_length(${t.nome}) between 1 and 80 and char_length(${t.fonte}) between 2 and 300`),
    check('referencias_nutrientes_valores_objeto', sql`jsonb_typeof(${t.valores}) = 'object'`),
  ],
);

export type ReferenciaNutrientesRow = typeof referenciasNutrientes.$inferSelect;

/** RN-250 (US-237): "Minhas refeições". `modo` como `meal_plans.modo`: `calculado` com itens, `livre` com o texto. */
export const refeicoesModelo = pgTable(
  'refeicoes_modelo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    nome: text('nome').notNull(),
    tipo: text('tipo').notNull(),
    horario: time('horario'),
    modo: text('modo').notNull().default('calculado'),
    descricaoLivre: text('descricao_livre'),
    observacao: text('observacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('refeicoes_modelo_tenant_id_unique').on(t.tenantId, t.id),
    check('refeicoes_modelo_tipo_valido', sql`${t.tipo} in (${listaSql(TIPOS_DE_REFEICAO)})`),
    check('refeicoes_modelo_modo_valido', sql`${t.modo} in ('calculado', 'livre')`),
    check(
      'refeicoes_modelo_textos_tamanho',
      sql`char_length(${t.nome}) between 1 and 60 and char_length(${t.observacao}) <= 2000 and (${t.descricaoLivre} is null or char_length(${t.descricaoLivre}) <= 2000)`,
    ),
    index('refeicoes_modelo_tenant_idx').on(t.tenantId, t.tipo),
  ],
);

export type RefeicaoModeloRow = typeof refeicoesModelo.$inferSelect;

/** RN-250: itens da minha refeição (mesmas regras de `meal_items`). `food_id` RESTRICT (RN-258). */
export const refeicoesModeloItens = pgTable(
  'refeicoes_modelo_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    refeicaoId: uuid('refeicao_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: gramas('quantidade_g').notNull(),
    medida: jsonb('medida').$type<MedidaDoItem>(),
    /** Item principal que esta substituição troca (mesma refeição). Nulo = item principal. */
    substituiItemId: uuid('substitui_item_id'),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('refeicoes_modelo_itens_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    check('refeicoes_modelo_itens_nao_substitui_a_si', sql`${t.substituiItemId} is null or ${t.substituiItemId} <> ${t.id}`),
    foreignKey({ columns: [t.tenantId, t.refeicaoId], foreignColumns: [refeicoesModelo.tenantId, refeicoesModelo.id], name: 'refeicoes_modelo_itens_refeicao_fk' }).onDelete(
      'cascade',
    ),
    unique('refeicoes_modelo_itens_tenant_refeicao_id_unique').on(t.tenantId, t.refeicaoId, t.id),
    foreignKey({
      columns: [t.tenantId, t.refeicaoId, t.substituiItemId],
      foreignColumns: [t.tenantId, t.refeicaoId, t.id],
      name: 'refeicoes_modelo_itens_principal_fk',
    }).onDelete('cascade'),
    index('refeicoes_modelo_itens_refeicao_idx').on(t.tenantId, t.refeicaoId, t.ordem),
    index('refeicoes_modelo_itens_alimento_idx').on(t.foodId),
  ],
);

export type RefeicaoModeloItemRow = typeof refeicoesModeloItens.$inferSelect;

/** RN-251 (US-238): lista de substituição do consultório. */
export const listasSubstituicao = pgTable(
  'listas_substituicao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    nome: text('nome').notNull(),
    orientacao: text('orientacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('listas_substituicao_tenant_id_unique').on(t.tenantId, t.id),
    unique('listas_substituicao_nome_unique').on(t.tenantId, t.nome),
    check('listas_substituicao_textos_tamanho', sql`char_length(${t.nome}) between 1 and 80 and char_length(${t.orientacao}) <= 1000`),
  ],
);

export type ListaSubstituicaoRow = typeof listasSubstituicao.$inferSelect;

export const listasSubstituicaoGrupos = pgTable(
  'listas_substituicao_grupos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    listaId: uuid('lista_id').notNull(),
    nome: text('nome').notNull(),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('listas_substituicao_grupos_nome_tamanho', sql`char_length(${t.nome}) between 1 and 60`),
    foreignKey({ columns: [t.tenantId, t.listaId], foreignColumns: [listasSubstituicao.tenantId, listasSubstituicao.id], name: 'listas_substituicao_grupos_lista_fk' }).onDelete(
      'cascade',
    ),
    unique('listas_substituicao_grupos_tenant_lista_id_unique').on(t.tenantId, t.listaId, t.id),
    index('listas_substituicao_grupos_lista_idx').on(t.tenantId, t.listaId, t.ordem),
  ],
);

export type ListaSubstituicaoGrupoRow = typeof listasSubstituicaoGrupos.$inferSelect;

/** RN-251: itens do grupo. `food_id` RESTRICT (RN-258). */
export const listasSubstituicaoItens = pgTable(
  'listas_substituicao_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    listaId: uuid('lista_id').notNull(),
    grupoId: uuid('grupo_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: gramas('quantidade_g').notNull(),
    medida: jsonb('medida').$type<MedidaDoItem>(),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('listas_substituicao_itens_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    foreignKey({
      columns: [t.tenantId, t.listaId, t.grupoId],
      foreignColumns: [listasSubstituicaoGrupos.tenantId, listasSubstituicaoGrupos.listaId, listasSubstituicaoGrupos.id],
      name: 'listas_substituicao_itens_grupo_fk',
    }).onDelete('cascade'),
    index('listas_substituicao_itens_grupo_idx').on(t.tenantId, t.grupoId, t.ordem),
    index('listas_substituicao_itens_alimento_idx').on(t.foodId),
  ],
);

export type ListaSubstituicaoItemRow = typeof listasSubstituicaoItens.$inferSelect;
