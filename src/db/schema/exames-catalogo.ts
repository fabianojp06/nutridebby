import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jsonbSeguro } from '../jsonb-seguro';
import { tenants } from './platform';

/**
 * Plano 22 (spec §9.1, RN-374): faixa do consultório para um exame do catálogo. `aPartirDe` é inclusivo e `abaixoDe`
 * exclusivo; sexo e idade (anos completos) opcionais. A categoria nunca é gravada no exame (EP-D11): é calculada na leitura.
 * Os textos e limites são conferidos pelo Zod (catalogo-regras.ts); o banco só limita o tamanho do array.
 */
export type FaixaDoConsultorio = {
  sexo: 'F' | 'M' | null;
  idadeMin: number | null;
  idadeMax: number | null;
  /** inclusivo */
  aPartirDe: number | null;
  /** exclusivo */
  abaixoDe: number | null;
  categoria: string;
  fonte: string;
  /** AAAA-MM-DD */
  atualizadaEm: string;
};

/** Plano 22 (spec §9.2): um exame de um modelo de solicitação (`painel` quando é um painel do catálogo). */
export type ExameDaLista = { nome: string; painel?: true };

/**
 * Plano 22 (spec §9.1, RN-370 a RN-374, EP-D8 a EP-D10): catálogo de exames do consultório. Só a equipe (staff_only, sem
 * paciente). Painel = `componentes` não vazio, sem unidade, faixas nem modelos de nota (um nível). Os CHECKs de array usam
 * `case` para fixar a ordem: um objeto em `jsonb_array_length` levantaria 22023 em vez do 23514 do CHECK. A unicidade dos
 * outros nomes normalizados é do módulo (RN-371).
 */
export const examesCatalogo = pgTable(
  'exames_catalogo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    unidade: text('unidade'),
    sinonimos: jsonbSeguro('sinonimos').$type<string[]>().notNull().default([]),
    componentes: jsonbSeguro('componentes').$type<string[]>().notNull().default([]),
    faixas: jsonbSeguro('faixas').$type<FaixaDoConsultorio[]>().notNull().default([]),
    modeloNotaAbaixo: text('modelo_nota_abaixo'),
    modeloNotaAcima: text('modelo_nota_acima'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('exames_catalogo_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
    check('exames_catalogo_unidade_tamanho', sql`${t.unidade} is null or char_length(${t.unidade}) between 1 and 20`),
    check('exames_catalogo_sinonimos', sql`case when jsonb_typeof(${t.sinonimos}) = 'array' then jsonb_array_length(${t.sinonimos}) <= 10 else false end`),
    check('exames_catalogo_componentes', sql`case when jsonb_typeof(${t.componentes}) = 'array' then jsonb_array_length(${t.componentes}) <= 30 else false end`),
    check('exames_catalogo_faixas', sql`case when jsonb_typeof(${t.faixas}) = 'array' then jsonb_array_length(${t.faixas}) <= 20 else false end`),
    check('exames_catalogo_modelo_nota_abaixo_tamanho', sql`${t.modeloNotaAbaixo} is null or char_length(${t.modeloNotaAbaixo}) <= 1000`),
    check('exames_catalogo_modelo_nota_acima_tamanho', sql`${t.modeloNotaAcima} is null or char_length(${t.modeloNotaAcima}) <= 1000`),
    check(
      'exames_catalogo_painel',
      sql`${t.componentes} = '[]'::jsonb or (${t.unidade} is null and ${t.faixas} = '[]'::jsonb and ${t.modeloNotaAbaixo} is null and ${t.modeloNotaAcima} is null)`,
    ),
    check('exames_catalogo_faixa_com_unidade', sql`${t.unidade} is not null or ${t.faixas} = '[]'::jsonb`),
    uniqueIndex('exames_catalogo_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
  ],
);
export type ExameCatalogoRow = typeof examesCatalogo.$inferSelect;

/**
 * Plano 22 (spec §9.2, EP-D5 a EP-D7): modelos de solicitação de exames do consultório — 1 a 40 exames por cópia (sem FK
 * para o catálogo). Só a equipe (staff_only, sem paciente).
 */
export const examesModelosSolicitacao = pgTable(
  'exames_modelos_solicitacao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    exames: jsonbSeguro('exames').$type<ExameDaLista[]>().notNull(),
    orientacoes: text('orientacoes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('exames_modelos_solicitacao_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
    check('exames_modelos_solicitacao_exames', sql`case when jsonb_typeof(${t.exames}) = 'array' then jsonb_array_length(${t.exames}) between 1 and 40 else false end`),
    check('exames_modelos_solicitacao_orientacoes_tamanho', sql`char_length(${t.orientacoes}) <= 1000`),
    uniqueIndex('exames_modelos_solicitacao_nome_unico').on(t.tenantId, sql`lower(${t.nome})`),
  ],
);
export type ModeloSolicitacaoRow = typeof examesModelosSolicitacao.$inferSelect;
