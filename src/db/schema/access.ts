import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

/** Convites de primeiro acesso (US-001). Só o SHA-256 do token é guardado. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invites_tipo_valido', sql`${t.tipo} in ('nutri')`),
    index('invites_user_idx').on(t.userId),
    // T5-R3: só um convite pendente (não usado) por usuário — impede que um duplo clique em
    // "Reenviar convite" deixe dois convites válidos ao mesmo tempo.
    uniqueIndex('invites_user_pendente_idx').on(t.userId).where(sql`${t.usadoEm} is null`),
  ],
);

/** Aceites versionados (DPA da nutricionista agora; termo do paciente no Plano 03). Sem cascade: é prova de aceite. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    termoVersao: text('termo_versao').notNull(),
    aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [unique('consents_user_termo_unique').on(t.userId, t.termoVersao)],
);
