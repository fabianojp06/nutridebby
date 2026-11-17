import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { foods } from './alimentos';
import type { ValoresDaReferencia } from './biblioteca-plano';
import { iaGeracoesModelos } from './ia';
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

/** Plano 19 (RN-238): cópia do perfil de referência gravada na publicação (o id é o do perfil no momento). */
export type ReferenciaCongelada = { id: string; nome: string; fonte: string; valores: ValoresDaReferencia };
/** Plano 19 (RN-244): distribuição de macros do plano em texto livre, em % do VET (formato conferido no código). */
export type MacrosPrescritos = { proteina: number; carboidrato: number; lipidio: number };

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
    /** US-026: quando o PDF atual foi pedido (pdf_status virou 'pendente'); a rede de segurança mede a idade do pendente por aqui. */
    pdfPedidoEm: timestamp('pdf_pedido_em', { withTimezone: true }),
    /** Plano 14B (US-123 (f)): o modelo sugerido pela IA — a geração de onde veio (nunca muda, gatilho 0112). Só em modelo. */
    iaGeracaoId: uuid('ia_geracao_id'),
    /** Plano 14B (US-123 (g), RN-125): quem aprovou o modelo sugerido e quando (imutáveis depois de gravados). */
    aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
    aprovadoPor: uuid('aprovado_por'),
    /** Plano 14B (RN-117, A-D13): o plano do paciente veio do rascunho da IA — o selo do art. 37 no PDF e no app. "Editar" copia. */
    iaOrigemEm: timestamp('ia_origem_em', { withTimezone: true }),
    /** Plano 19 (RN-243, D15): `calculado` (alimentos e quantidades) ou `livre` (texto por refeição). */
    modo: text('modo').notNull().default('calculado'),
    /**
     * Plano 19 (RN-238, D30): perfil de referência do rascunho ou modelo. A FK composta `(tenant_id, referencia_id)` com
     * `ON DELETE SET NULL (referencia_id)` fica na migration custom `plano19_fks_dias_conteudos` (o Drizzle não gera a lista
     * de colunas). A publicação zera e guarda a cópia em `referenciaCongelada`.
     */
    referenciaId: uuid('referencia_id'),
    /** Plano 19 (RN-239): até 12 chaves do catálogo de nutrientes (conferidas no código). */
    nutrientesExibidos: text('nutrientes_exibidos').array().notNull().default(sql`'{}'::text[]`),
    referenciaCongelada: jsonb('referencia_congelada').$type<ReferenciaCongelada>(),
    macrosPrescritos: jsonb('macros_prescritos').$type<MacrosPrescritos>(),
    /** Plano 19 (RN-239, D12): o PDF mostra os nutrientes escolhidos (só com `mostrar_calorias` também ligado). */
    mostrarMicrosPdf: boolean('mostrar_micros_pdf').notNull().default(false),
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
    check('meal_plans_ia_geracao_so_modelo', sql`${t.iaGeracaoId} is null or ${t.isTemplate}`),
    check('meal_plans_aprovacao_coerente', sql`(${t.aprovadoEm} is null) = (${t.aprovadoPor} is null) and (${t.aprovadoEm} is null or ${t.iaGeracaoId} is not null)`),
    foreignKey({ columns: [t.tenantId, t.iaGeracaoId], foreignColumns: [iaGeracoesModelos.tenantId, iaGeracoesModelos.id], name: 'meal_plans_ia_geracao_fk' }),
    check('meal_plans_ia_origem_so_paciente', sql`${t.iaOrigemEm} is null or not ${t.isTemplate}`),
    check('meal_plans_modo_valido', sql`${t.modo} in ('calculado', 'livre')`),
    check('meal_plans_nutrientes_exibidos_limite', sql`cardinality(${t.nutrientesExibidos}) <= 12`),
    // RN-238 / D30: só o rascunho (e o modelo, sempre rascunho) aponta para o perfil; o publicado guarda só a cópia
    check('meal_plans_referencia_so_rascunho', sql`${t.referenciaId} is null or ${t.status} = 'rascunho'`),
    check('meal_plans_referencia_congelada_publicada', sql`${t.referenciaCongelada} is null or ${t.status} <> 'rascunho'`),
    check('meal_plans_macros_so_livre', sql`${t.macrosPrescritos} is null or ${t.modo} = 'livre'`),
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
    /**
     * US-054 (D13): receita sugerida nesta refeição — não entra no total. A FK composta com
     * `ON DELETE SET NULL (recipe_content_id)` fica na migration 0082 (o Drizzle não gera a lista de colunas).
     */
    recipeContentId: uuid('recipe_content_id'),
    /**
     * Plano 19 (RN-246, D17): dias em que a refeição vale, 0 = domingo … 6 = sábado (convenção do Plano 17). O CHECK
     * `meals_dias_validos` (função `app_dias_semana_validos`) fica na migration custom `plano19_fks_dias_conteudos`.
     */
    diasSemana: smallint('dias_semana').array().notNull().default(sql`'{0,1,2,3,4,5,6}'::smallint[]`),
    /** Plano 19 (RN-243): o texto da refeição no plano em texto livre (nulo no calculado). */
    descricaoLivre: text('descricao_livre'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('meals_textos_tamanho', sql`char_length(${t.nome}) between 1 and 60 and char_length(${t.observacao}) <= 2000`),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [mealPlans.tenantId, mealPlans.id], name: 'meals_plano_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.planId, t.patientId], foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId], name: 'meals_plano_paciente_fk' }).onDelete('cascade'),
    unique('meals_tenant_plano_id_unique').on(t.tenantId, t.planId, t.id),
    index('meals_plano_idx').on(t.tenantId, t.planId, t.ordem),
    // a exceção da RN-12 (política paciente_conteudo_visivel) e o SET NULL procuram a refeição pela receita
    index('meals_receita_idx').on(t.tenantId, t.recipeContentId).where(sql`${t.recipeContentId} is not null`),
    check('meals_descricao_livre_tamanho', sql`${t.descricaoLivre} is null or char_length(${t.descricaoLivre}) <= 2000`),
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

/**
 * Plano 19 (RN-252, D23): lista de substituição ligada ao plano — CÓPIA congelada da lista da biblioteca (grupos e itens
 * com nome, gramas, medida, fonte e valores por 100 g; formato conferido no código). `patient_id` nulo = modelo. O
 * paciente vê só a do plano publicado (`paciente_sem_rascunho`); escritas auditadas (entidade `plano_alimentar`).
 * O teto de 512 KB cobre o pior caso dos limites da lista (20 grupos × 30 itens, spec §9.2 v0.3).
 */
export const planoListasSubstituicao = pgTable(
  'plano_listas_substituicao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    /** De qual lista da biblioteca veio a cópia ("Atualizar da biblioteca"). Sem FK: só informativo. */
    listaOrigemId: uuid('lista_origem_id'),
    nome: text('nome').notNull(),
    orientacao: text('orientacao').notNull().default(''),
    conteudo: jsonb('conteudo').$type<Record<string, unknown>>().notNull(),
    copiadaEm: timestamp('copiada_em', { withTimezone: true }).notNull().defaultNow(),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('plano_listas_substituicao_textos_tamanho', sql`char_length(${t.nome}) between 1 and 80 and char_length(${t.orientacao}) <= 1000`),
    check('plano_listas_substituicao_conteudo_valido', sql`jsonb_typeof(${t.conteudo}) = 'object' and octet_length(${t.conteudo}::text) <= 524288`),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [mealPlans.tenantId, mealPlans.id], name: 'plano_listas_substituicao_plano_fk' }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.planId, t.patientId],
      foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId],
      name: 'plano_listas_substituicao_plano_paciente_fk',
    }).onDelete('cascade'),
    index('plano_listas_substituicao_plano_idx').on(t.tenantId, t.planId, t.ordem),
  ],
);

export type PlanoListaSubstituicaoRow = typeof planoListasSubstituicao.$inferSelect;

/**
 * Plano 19 (RN-253, D24): receita, orientação ou vídeo ligado ao plano (RN-12, exceção ampliada). A FK composta
 * `(tenant_id, content_id)` → `contents` com `ON DELETE SET NULL (content_id)` fica na migration custom
 * `plano19_fks_dias_conteudos`: excluído o conteúdo, a ligação fica com o título copiado. Escritas auditadas.
 */
export const planoConteudos = pgTable(
  'plano_conteudos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id'),
    planId: uuid('plan_id').notNull(),
    contentId: uuid('content_id'),
    /** Cópia do título na ligação: o que o editor mostra se o conteúdo for excluído ("{título} (excluído)"). */
    titulo: text('titulo').notNull(),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('plano_conteudos_titulo_tamanho', sql`char_length(${t.titulo}) between 1 and 120`),
    unique('plano_conteudos_unique').on(t.planId, t.contentId),
    foreignKey({ columns: [t.tenantId, t.planId], foreignColumns: [mealPlans.tenantId, mealPlans.id], name: 'plano_conteudos_plano_fk' }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.planId, t.patientId],
      foreignColumns: [mealPlans.tenantId, mealPlans.id, mealPlans.patientId],
      name: 'plano_conteudos_plano_paciente_fk',
    }).onDelete('cascade'),
    index('plano_conteudos_plano_idx').on(t.tenantId, t.planId, t.ordem),
    // a exceção da RN-12 (política paciente_conteudo_visivel) e o SET NULL procuram a ligação pelo conteúdo
    index('plano_conteudos_conteudo_idx').on(t.tenantId, t.contentId).where(sql`${t.contentId} is not null`),
  ],
);

export type PlanoConteudoRow = typeof planoConteudos.$inferSelect;
