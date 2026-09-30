import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { patients } from './pacientes';
import { tenants } from './platform';

/**
 * Convites de primeiro acesso. Só o SHA-256 do token é guardado.
 * - `nutri` (US-001, 72 h): aponta para o usuário já criado sem senha.
 * - `paciente` (US-010, 7 dias): aponta para o prontuário (tenant + paciente); a conta só nasce no aceite.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    patientId: uuid('patient_id'),
    tipo: text('tipo').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invites_tipo_valido', sql`${t.tipo} in ('nutri', 'paciente')`),
    check(
      'invites_alvo',
      sql`(${t.tipo} = 'nutri' and ${t.userId} is not null and ${t.patientId} is null)
       or (${t.tipo} = 'paciente' and ${t.userId} is null and ${t.tenantId} is not null and ${t.patientId} is not null)`,
    ),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'invites_paciente_fk' }).onDelete('cascade'),
    index('invites_user_idx').on(t.userId),
    // T5-R3: só um convite pendente (não usado) por usuário — impede que um duplo clique em
    // "Reenviar convite" deixe dois convites válidos ao mesmo tempo. O mesmo vale por paciente.
    uniqueIndex('invites_user_pendente_idx').on(t.userId).where(sql`${t.usadoEm} is null`),
    uniqueIndex('invites_paciente_pendente_idx').on(t.patientId).where(sql`${t.usadoEm} is null`),
  ],
);

/** Aceites versionados (DPA da nutricionista; termo do paciente). Sem cascade: é prova de aceite. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    /** Termo do paciente: o tenant do vínculo aceito. DPA da nutricionista: nulo. */
    tenantId: uuid('tenant_id').references(() => tenants.id),
    termoVersao: text('termo_versao').notNull(),
    aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [unique('consents_user_termo_tenant_unique').on(t.userId, t.termoVersao, t.tenantId).nullsNotDistinct()],
);
