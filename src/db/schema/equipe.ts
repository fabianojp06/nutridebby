import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './platform';

/** Plano 26 (spec §9.1): os papéis da equipe além da nutricionista — lista pronta para papéis futuros. */
export const PAPEIS_DA_EQUIPE = ['recepcao'] as const;
export type PapelDaEquipe = (typeof PAPEIS_DA_EQUIPE)[number];

/**
 * Plano 26 (spec §9.1, RN-498 a RN-503): a recepção do consultório — uma linha por conta `recepcao`. Só a sessão `nutri` grava
 * (gatilho equipe_membros_regras: `convidada_por` e `desativada_por` da sessão; `id`, `tenant_id`, `user_id`, `papel`,
 * `convidada_por` e `created_at` fixos); a recepção só lê a própria linha (recepcao_cond_propria_linha); o paciente nada
 * (staff_only). Nunca é apagada (DELETE e TRUNCATE revogados, RE-D28): desativa-se. Sem paciente, sem gatilho de auditoria (o
 * módulo grava `recordAudit` da entidade `equipe`).
 */
export const equipeMembros = pgTable(
  'equipe_membros',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => user.id),
    papel: text('papel').$type<PapelDaEquipe>().notNull(),
    /** RN-502: permissão do Financeiro, só a nutricionista muda. */
    financeiro: boolean('financeiro').notNull().default(false),
    convidadaPor: uuid('convidada_por').notNull(),
    desativadaEm: timestamp('desativada_em', { withTimezone: true }),
    desativadaPor: uuid('desativada_por'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('equipe_membros_papel_valido', sql`${t.papel} in ('recepcao')`),
    check('equipe_membros_desativacao', sql`(${t.desativadaEm} is null) = (${t.desativadaPor} is null)`),
    // RN-499: a contagem do limite de 3 ativas por consultório
    index('equipe_membros_ativas_idx').on(t.tenantId).where(sql`${t.desativadaEm} is null`),
  ],
);
export type EquipeMembroRow = typeof equipeMembros.$inferSelect;
