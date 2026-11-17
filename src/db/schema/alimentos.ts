import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { FONTES_DE_ALIMENTO } from '../../modules/alimentos/fontes'; // relativo: o drizzle-kit não resolve o alias @/
import { GRUPOS_TACO } from '../../modules/alimentos/grupos'; // relativo: o drizzle-kit não resolve o alias @/
import { tenants } from './platform';

export type MedidaCaseira = { nome: string; plural: string; gramas: number };

const porCem = (nome: string) => numeric(nome, { precision: 7, scale: 2, mode: 'number' });
const listaSql = (vs: readonly string[]) => sql.raw(vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));

/**
 * INT-04, US-020, US-021. Valores por 100 g. `tenant_id` nulo = tabela pública (TACO 4ª ed.; USDA e TBCA no Plano 19,
 * pela `fonte`), somente leitura: política `taco_leitura`, D1, e nenhuma política de escrita com tenant_id nulo;
 * preenchido = "Meu alimento" da nutricionista. `medidas_caseiras` = seed do IBGE (Tarefa 2).
 */
export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    tacoId: smallint('taco_id').unique('foods_taco_id_unique'),
    nome: text('nome').notNull(),
    grupo: text('grupo').notNull(),
    kcal: porCem('kcal'),
    proteinaG: porCem('proteina_g'),
    carboidratoG: porCem('carboidrato_g'),
    lipidioG: porCem('lipidio_g'),
    fibraG: porCem('fibra_g'),
    micros: jsonb('micros').$type<Record<string, number | null>>().notNull().default({}),
    medidasCaseiras: jsonb('medidas_caseiras').$type<MedidaCaseira[]>().notNull().default([]),
    /** "Duplicar como meu alimento": de qual alimento (TACO) veio a cópia. Sem FK: só informativo. */
    origemFoodId: uuid('origem_food_id'),
    /**
     * Plano 19 (RN-230): tabela de origem. O default `'propria'` é PERMANENTE (spec I-2, §9.1): a imagem antiga, no ar
     * durante o boot do app novo e na volta atrás, grava "Cadastrar meu alimento" e "Duplicar" sem `fonte`, e o default
     * mantém essas linhas válidas no CHECK `foods_origem_valida`. Nunca tirar o default.
     */
    fonte: text('fonte').notNull().default('propria'),
    /** Plano 19: o código na tabela de origem (número da TACO, `fdc_id` da USDA, código da TBCA); nulo no "Meu alimento". */
    fonteRef: text('fonte_ref'),
    /** Plano 19: o nome em inglês da USDA (nulo nas outras fontes); a busca procura nos dois nomes. */
    nomeOriginal: text('nome_original'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Plano 19 (RN-230): tabela pública ⇔ tenant_id nulo; fonte_ref só (e sempre) nas públicas; taco_id só na TACO
    check(
      'foods_origem_valida',
      sql`(${t.tenantId} is null) = (${t.fonte} <> 'propria') and (${t.fonte} = 'propria') = (${t.fonteRef} is null) and (${t.tacoId} is not null) = (${t.fonte} = 'taco')`,
    ),
    check(
      'foods_proprio_completo',
      sql`${t.tenantId} is null or (${t.kcal} is not null and ${t.proteinaG} is not null and ${t.carboidratoG} is not null and ${t.lipidioG} is not null and ${t.fibraG} is not null)`,
    ),
    check(
      'foods_valores_faixa',
      sql`coalesce(${t.kcal}, 0) between 0 and 1000 and coalesce(${t.proteinaG}, 0) between 0 and 100 and coalesce(${t.carboidratoG}, 0) between 0 and 100 and coalesce(${t.lipidioG}, 0) between 0 and 100 and coalesce(${t.fibraG}, 0) between 0 and 100`,
    ),
    check('foods_grupo_valido', sql`${t.grupo} in (${listaSql(GRUPOS_TACO)})`),
    check('foods_nome_tamanho', sql`char_length(${t.nome}) between 2 and 120`),
    index('foods_tenant_idx').on(t.tenantId),
    check('foods_fonte_valida', sql`${t.fonte} in (${listaSql(FONTES_DE_ALIMENTO)})`),
    check('foods_fonte_ref_tamanho', sql`${t.fonteRef} is null or char_length(${t.fonteRef}) between 1 and 40`),
    check('foods_nome_original_valido', sql`${t.nomeOriginal} is null or (${t.fonte} = 'usda' and char_length(${t.nomeOriginal}) between 2 and 200)`),
    unique('foods_fonte_ref_unique').on(t.fonte, t.fonteRef),
    // Plano 19 (RN-242): equivalentes e filtro de grupo. O índice de trigramas de nome_original vem com o seed da USDA (D29).
    index('foods_grupo_idx').on(t.grupo),
  ],
);

export type FoodRow = typeof foods.$inferSelect;

/** US-020 "Cadastrar medida caseira": medidas da nutricionista (complementam o seed do IBGE em foods.medidas_caseiras). */
export const foodMeasures = pgTable(
  'food_measures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    plural: text('plural').notNull(),
    gramas: numeric('gramas', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('food_measures_nome_unique').on(t.tenantId, t.foodId, t.nome),
    check('food_measures_gramas_faixa', sql`${t.gramas} between 0.1 and 5000`),
    check('food_measures_nome_tamanho', sql`char_length(${t.nome}) between 2 and 60 and char_length(${t.plural}) between 2 and 60`),
    index('food_measures_alimento_idx').on(t.tenantId, t.foodId),
  ],
);

export type FoodMeasureRow = typeof foodMeasures.$inferSelect;
