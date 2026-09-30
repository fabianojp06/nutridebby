import { sql } from 'drizzle-orm';
import { check, customType, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './platform';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Prontuário (M2). `user_id` nulo até o paciente aceitar o convite. `data_nascimento` e `sexo`
 * alimentam as fórmulas; só podem faltar em paciente do agendamento público (Plano 05) ou anonimizado.
 * `patients_tenant_id_unique` é o alvo das FKs compostas das tabelas filhas: um registro do tenant A
 * nunca aponta para paciente do tenant B, nem por bug de serviço.
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    dataNascimento: date('data_nascimento', { mode: 'string' }),
    sexo: text('sexo'),
    telefoneE164: text('telefone_e164'),
    email: citext('email').notNull(),
    origem: text('origem').notNull().default('nutri'),
    whatsappOptinEm: timestamp('whatsapp_optin_em', { withTimezone: true }),
    whatsappOptinOrigem: text('whatsapp_optin_origem'),
    whatsappOptoutEm: timestamp('whatsapp_optout_em', { withTimezone: true }),
    status: text('status').notNull().default('ativo'),
    bloqueadoEm: timestamp('bloqueado_em', { withTimezone: true }),
    anonimizarApos: date('anonimizar_apos', { mode: 'string' }),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patients_tenant_email_unique').on(t.tenantId, t.email),
    unique('patients_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('patients_tenant_user_idx').on(t.tenantId, t.userId).where(sql`${t.userId} is not null`),
    index('patients_tenant_status_idx').on(t.tenantId, t.status),
    check('patients_sexo_valido', sql`${t.sexo} is null or ${t.sexo} in ('F', 'M')`),
    check('patients_origem_valida', sql`${t.origem} in ('nutri', 'agendamento_publico')`),
    check('patients_status_valido', sql`${t.status} in ('ativo', 'arquivado', 'bloqueado')`),
    check('patients_optin_origem_valida', sql`${t.whatsappOptinOrigem} is null or ${t.whatsappOptinOrigem} in ('nutri', 'paciente')`),
    check('patients_telefone_e164', sql`${t.telefoneE164} is null or ${t.telefoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'patients_nascimento_e_sexo',
      sql`${t.origem} = 'agendamento_publico' or ${t.anonimizadoEm} is not null or (${t.dataNascimento} is not null and ${t.sexo} is not null)`,
    ),
  ],
);

export type PatientRow = typeof patients.$inferSelect;

/** US-019. Nome sem diferenciar maiúsculas ("Gestante" = "gestante"). A sessão de paciente não vê (staff_only). */
export const patientTags = pgTable(
  'patient_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: citext('nome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tags_tenant_nome_unique').on(t.tenantId, t.nome),
    unique('patient_tags_tenant_id_unique').on(t.tenantId, t.id),
    check('patient_tags_nome_tamanho', sql`char_length(${t.nome}) between 1 and 40`),
  ],
);

export const patientTagLinks = pgTable(
  'patient_tag_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tag_links_unique').on(t.patientId, t.tagId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'patient_tag_links_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [patientTags.tenantId, patientTags.id], name: 'patient_tag_links_etiqueta_fk' }).onDelete('cascade'),
    index('patient_tag_links_etiqueta_idx').on(t.tenantId, t.tagId),
  ],
);

/** US-013. `imc` é calculado pelo banco; densidade e %G, pelo serviço (Apêndice A), só com as dobras completas. */
export const anthropometry = pgTable(
  'anthropometry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    imc: numeric('imc', { precision: 6, scale: 2, mode: 'number' }).generatedAlwaysAs(sql`round(peso_kg / ((altura_cm / 100) * (altura_cm / 100)), 2)`),
    circunferencias: jsonb('circunferencias').$type<Record<string, number>>().notNull().default({}),
    dobrasMm: jsonb('dobras_mm').$type<Record<string, number>>().notNull().default({}),
    protocolo: text('protocolo').notNull().default('nenhum'),
    densidade: numeric('densidade', { precision: 6, scale: 5, mode: 'number' }),
    percGordura: numeric('perc_gordura', { precision: 5, scale: 2, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('anthropometry_peso_faixa', sql`${t.pesoKg} between 1 and 400`),
    check('anthropometry_altura_faixa', sql`${t.alturaCm} between 30 and 250`),
    check('anthropometry_protocolo_valido', sql`${t.protocolo} in ('jp3', 'jp7', 'nenhum')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'anthropometry_paciente_fk' }),
    index('anthropometry_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type AnthropometryRow = typeof anthropometry.$inferSelect;

/** US-014. Guarda o que entrou na conta (peso, altura, idade, sexo) e o resultado sem arredondar; a tela mostra kcal inteiros. */
export const energyCalcs = pgTable(
  'energy_calcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    formula: text('formula').notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    idade: integer('idade').notNull(),
    sexo: text('sexo').notNull(),
    fatorAtividade: numeric('fator_atividade', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    // 6 casas: o mesmo valor que as fórmulas devolvem; com 2 casas, 1500,4951 viraria 1500,50 e a lista
    // mostraria 1501 onde a tela de sucesso mostrou 1500 (arredondamento duplo, RN-14)
    tmb: numeric('tmb', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    get: numeric('get', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('energy_calcs_formula_valida', sql`${t.formula} in ('harris_benedict', 'mifflin', 'fao_oms')`),
    check('energy_calcs_fator_faixa', sql`${t.fatorAtividade} between 1.00 and 2.50`),
    check('energy_calcs_sexo_valido', sql`${t.sexo} in ('F', 'M')`),
    check('energy_calcs_idade_adulto', sql`${t.idade} >= 18`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'energy_calcs_paciente_fk' }),
    index('energy_calcs_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);

export type EnergyCalcRow = typeof energyCalcs.$inferSelect;
