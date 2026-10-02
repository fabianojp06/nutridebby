import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './platform';

/** US-030: horários de atendimento por dia da semana (0 = domingo), em 'HH:MM' no fuso do tenant. O paciente não vê (staff_only, D11). */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    diaSemana: smallint('dia_semana').notNull(),
    inicio: time('inicio').notNull(),
    fim: time('fim').notNull(),
    duracaoMin: smallint('duracao_min').notNull(),
    modalidade: text('modalidade').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('availability_rules_dia_valido', sql`${t.diaSemana} between 0 and 6`),
    check('availability_rules_fim_depois', sql`${t.fim} > ${t.inicio}`),
    check('availability_rules_duracao_faixa', sql`${t.duracaoMin} between 15 and 240`),
    check('availability_rules_modalidade_valida', sql`${t.modalidade} in ('presencial', 'online', 'ambas')`),
    index('availability_rules_dia_idx').on(t.tenantId, t.diaSemana),
  ],
);

/** US-030: bloqueios (férias, congresso). O motivo pode ser pessoal: o paciente não vê (staff_only). */
export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    motivo: text('motivo').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('availability_blocks_fim_depois', sql`${t.fim} > ${t.inicio}`),
    check('availability_blocks_motivo_tamanho', sql`char_length(${t.motivo}) <= 120`),
    index('availability_blocks_periodo_idx').on(t.tenantId, t.inicio),
  ],
);
