import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { GRUPOS_TACO } from '../../modules/alimentos/grupos'; // relativo: o drizzle-kit não resolve o alias @/
import { tenants } from './platform';

export type MedidaCaseira = { nome: string; plural: string; gramas: number };

const porCem = (nome: string) => numeric(nome, { precision: 7, scale: 2, mode: 'number' });
const listaSql = (vs: readonly string[]) => sql.raw(vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));

/**
 * INT-04, US-020, US-021. Valores por 100 g. `tenant_id` nulo = TACO 4ª ed. (somente leitura: política
 * `taco_leitura`, D1); preenchido = "Meu alimento" da nutricionista. `medidas_caseiras` = seed do IBGE (Tarefa 2).
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('foods_origem_valida', sql`(${t.tenantId} is null) = (${t.tacoId} is not null)`),
    check(
      'foods_proprio_completo',
      sql`${t.tenantId} is null or (${t.kcal} is not null and ${t.proteinaG} is not null and ${t.carboidratoG} is not null and ${t.lipidioG} is not null and ${t.fibraG} is not null)`,
    ),
    check(
      'foods_valores_faixa',
      sql`coalesce(${t.kcal}, 0) between 0 and 900 and coalesce(${t.proteinaG}, 0) between 0 and 100 and coalesce(${t.carboidratoG}, 0) between 0 and 100 and coalesce(${t.lipidioG}, 0) between 0 and 100 and coalesce(${t.fibraG}, 0) between 0 and 100`,
    ),
    check('foods_grupo_valido', sql`${t.grupo} in (${listaSql(GRUPOS_TACO)})`),
    check('foods_nome_tamanho', sql`char_length(${t.nome}) between 2 and 120`),
    index('foods_tenant_idx').on(t.tenantId),
  ],
);

export type FoodRow = typeof foods.$inferSelect;
