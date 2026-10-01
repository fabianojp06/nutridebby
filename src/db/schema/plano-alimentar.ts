import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { foods } from './alimentos';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

export type MedidaDoItem = { nome: string; plural: string; gramas: number; qtd: number };
/** D10: cópia dos valores por 100 g e do nome no momento da publicação (plano publicado é imutável, RN-01). */
export type NutrientesCongelados = {
  nome: string;
  origem: 'TACO' | 'Meu alimento';
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  lipidioG: number | null;
  fibraG: number | null;
};

/** US-022–026, RN-01. `patient_id` nulo = modelo (US-024). */
export const mealPlans = pgTable(
  'meal_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id'),
    isTemplate: boolean('is_template').notNull().default(false),
    titulo: text('titulo').notNull(),
    metaKcal: integer('meta_kcal'),
    /** Cálculo de gasto energético de onde veio a meta (referência sem FK; ver desvios). */
    energyCalcId: uuid('energy_calc_id'),
    status: text('status').notNull().default('rascunho'),
    versao: integer('versao').notNull().default(1),
    /** D7: trava otimista do salvamento automático. */
    revisao: integer('revisao').notNull().default(0),
    /** D7: `envio` (uuid do cliente) do último salvamento gravado; aceita a repetição de um envio cuja resposta se perdeu. */
    ultimoEnvio: uuid('ultimo_envio'),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    origemPlanId: uuid('origem_plan_id'),
    mostrarCalorias: boolean('mostrar_calorias').notNull().default(false),
    orientacoes: text('orientacoes').notNull().default(''),
    pdfPath: text('pdf_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    pdfStatus: text('pdf_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meal_plans_status_valido', sql`${t.status} in ('rascunho', 'publicado', 'arquivado')`),
    check('meal_plans_modelo_sem_paciente', sql`${t.isTemplate} = (${t.patientId} is null)`),
    check('meal_plans_modelo_rascunho', sql`not ${t.isTemplate} or ${t.status} = 'rascunho'`),
    check('meal_plans_versao_valida', sql`${t.versao} >= 1`),
    check('meal_plans_meta_faixa', sql`${t.metaKcal} is null or ${t.metaKcal} between 500 and 10000`),
    check('meal_plans_pdf_status_valido', sql`${t.pdfStatus} is null or ${t.pdfStatus} in ('pendente', 'pronto', 'falhou')`),
    check('meal_plans_pdf_do_tenant', sql`${t.pdfPath} is null or ${t.pdfPath} like ${t.tenantId}::text || '/plano_pdf/%'`),
    check('meal_plans_textos_tamanho', sql`char_length(${t.titulo}) between 1 and 120 and char_length(${t.orientacoes}) <= 2000`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'meal_plans_paciente_fk' }),
    unique('meal_plans_tenant_id_unique').on(t.tenantId, t.id),
    unique('meal_plans_tenant_id_paciente_unique').on(t.tenantId, t.id, t.patientId),
    // RN-01: no máximo 1 publicado por paciente; D11: no máximo 1 rascunho por paciente
    uniqueIndex('meal_plans_um_publicado_idx').on(t.tenantId, t.patientId).where(sql`${t.status} = 'publicado'`),
    uniqueIndex('meal_plans_um_rascunho_idx').on(t.tenantId, t.patientId).where(sql`${t.status} = 'rascunho' and ${t.patientId} is not null`),
    index('meal_plans_paciente_idx').on(t.tenantId, t.patientId, t.versao),
  ],
);

export type MealPlanRow = typeof mealPlans.$inferSelect;

export const meals = pgTable(
  'meals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    nome: text('nome').notNull(),
    horario: time('horario'),
    ordem: smallint('ordem').notNull(),
    observacao: text('observacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meals_textos_tamanho', sql`char_length(${t.nome}) between 1 and 60 and char_length(${t.observacao}) <= 2000`),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [mealPlans.tenantId, mealPlans.id], name: 'meals_plano_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.planId, t.patientId], foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId], name: 'meals_plano_paciente_fk' }).onDelete('cascade'),
    unique('meals_tenant_plano_id_unique').on(t.tenantId, t.planId, t.id),
    index('meals_plano_idx').on(t.tenantId, t.planId, t.ordem),
  ],
);

export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    mealId: uuid('meal_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: numeric('quantidade_g', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    medida: jsonb('medida').$type<MedidaDoItem>(),
    medidaCaseiraTxt: text('medida_caseira_txt'),
    /** D9: item principal que esta substituição troca (mesma refeição). Nulo = item principal. */
    substituiItemId: uuid('substitui_item_id'),
    ordem: smallint('ordem').notNull(),
    nutrientes: jsonb('nutrientes').$type<NutrientesCongelados>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meal_items_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    check('meal_items_nao_substitui_a_si', sql`${t.substituiItemId} is null or ${t.substituiItemId} <> ${t.id}`),
    foreignKey({ columns: [t.tenantId, t.planId, t.mealId], foreignColumns: [meals.tenantId, meals.planId, meals.id], name: 'meal_items_refeicao_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.planId, t.patientId], foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId], name: 'meal_items_plano_paciente_fk' }).onDelete('cascade'),
    unique('meal_items_tenant_refeicao_id_unique').on(t.tenantId, t.mealId, t.id),
    foreignKey({ columns: [t.tenantId, t.mealId, t.substituiItemId], foreignColumns: [t.tenantId, t.mealId, t.id], name: 'meal_items_principal_fk' }).onDelete('cascade'),
    index('meal_items_refeicao_idx').on(t.tenantId, t.mealId, t.ordem),
    index('meal_items_alimento_idx').on(t.foodId),
  ],
);
