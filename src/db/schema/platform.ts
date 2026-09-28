import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nomeExibicao: text('nome_exibicao').notNull(),
    status: text('status').notNull().default('ativa'),
    fuso: text('fuso').notNull().default('America/Sao_Paulo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_formato', sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check('tenants_status_valido', sql`${t.status} in ('ativa', 'suspensa')`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid('actor_user_id'),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: text('entidade_id'),
    /** Titular do dado (histórico por paciente, US-007). Nulo em ações que não são de um paciente. */
    patientId: uuid('patient_id'),
    ip: text('ip'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'audit_log_acao_valida',
      sql`${t.acao} in ('ler','criar','alterar','excluir','exportar','bloquear','anonimizar')`,
    ),
    index('audit_log_busca_idx').on(t.tenantId, t.entidade, t.entidadeId, t.criadoEm),
    index('audit_log_paciente_idx').on(t.tenantId, t.patientId, t.criadoEm),
  ],
);

export const systemHeartbeat = pgTable('system_heartbeat', {
  name: text('name').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
});
