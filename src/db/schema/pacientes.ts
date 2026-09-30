import { sql } from 'drizzle-orm';
import { check, customType, date, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
