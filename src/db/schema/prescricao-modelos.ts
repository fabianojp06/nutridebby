import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ItemPrescricao } from '@/modules/documentos/prescricao';
import { tenants } from './platform';

/**
 * Plano 22 (spec §9.3, RN-393, EP-D29): itens salvos de prescrição do consultório — um item da receita com nome (único sem
 * diferença de maiúsculas), validado pelo **mesmo** Zod do item da receita (`validarItem`), sem marca, fabricante ou
 * farmácia. "Adicionar item salvo" copia o item para a receita (sem FK). Só a equipe (staff_only, sem paciente). A coluna
 * `tipo` decide o grupo da lista ("Suplementos" × "Fitoterápicos"): o CHECK `prescricao_itens_salvos_tipo_coerente` a amarra
 * ao `item->>'tipo'` (M11 da revisão do plano: um item formulado listado como suplemento escaparia da leitura da habilitação).
 */
export const prescricaoItensSalvos = pgTable(
  'prescricao_itens_salvos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    tipo: text('tipo').$type<ItemPrescricao['tipo']>().notNull(),
    item: jsonb('item').$type<ItemPrescricao>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('prescricao_itens_salvos_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
    check('prescricao_itens_salvos_tipo_valido', sql`${t.tipo} in ('suplemento', 'planta_cha', 'derivado_vegetal', 'fitoterapico', 'formula_fitoterapica')`),
    check('prescricao_itens_salvos_item_objeto', sql`jsonb_typeof(${t.item}) = 'object'`),
    // `is not distinct from`, e não `=`: sem a chave `tipo` no item, o `=` daria NULL e o CHECK passaria
    check('prescricao_itens_salvos_tipo_coerente', sql`(${t.item}->>'tipo') is not distinct from ${t.tipo}`),
    uniqueIndex('prescricao_itens_salvos_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
  ],
);
export type ItemSalvoRow = typeof prescricaoItensSalvos.$inferSelect;

/**
 * Plano 22 (spec §9.4, RN-394, EP-D30): modelos de prescrição do consultório — nome (único sem diferença de maiúsculas),
 * 1 a 20 itens pelo mesmo Zod do item e orientações (até 2000, em marcação). **Sem** justificativa de uso e sem dado do
 * paciente. Só a equipe (staff_only, sem paciente). O CHECK de array usa `case` para fixar a ordem: um objeto em
 * `jsonb_array_length` levantaria 22023 em vez do 23514 do CHECK.
 */
export const prescricaoModelos = pgTable(
  'prescricao_modelos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    itens: jsonb('itens').$type<ItemPrescricao[]>().notNull(),
    orientacoes: text('orientacoes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('prescricao_modelos_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
    check('prescricao_modelos_itens', sql`case when jsonb_typeof(${t.itens}) = 'array' then jsonb_array_length(${t.itens}) between 1 and 20 else false end`),
    check('prescricao_modelos_orientacoes_tamanho', sql`char_length(${t.orientacoes}) <= 2000`),
    uniqueIndex('prescricao_modelos_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
  ],
);
export type ModeloPrescricaoRow = typeof prescricaoModelos.$inferSelect;
