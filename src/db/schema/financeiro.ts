import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appointments } from './agenda';
import { FORMAS_DE_PAGAMENTO, type FormaPagamento } from './financeiro-formas';
import { patients } from './pacientes';
import { tenants } from './platform';

/** Plano 20 (RN-304): os dois tipos de lançamento e de categoria. */
export const TIPOS_DE_LANCAMENTO = ['entrada', 'saida'] as const;
export type TipoLancamento = (typeof TIPOS_DE_LANCAMENTO)[number];

// RN-304: a lista das formas mora num arquivo puro (sem drizzle), para o cliente não levar o pg-core
export { FORMAS_DE_PAGAMENTO, type FormaPagamento } from './financeiro-formas';

const lista = (valores: readonly string[]) => sql.raw(valores.map((v) => `'${v}'`).join(', '));

/**
 * Plano 20 (spec §9.1, RN-301, RN-302, RN-324, RN-325): uma linha por consultório — o saldo do caixa numa data e o valor da
 * consulta (opcional). A primeira gravação semeia as categorias iniciais. DELETE e TRUNCATE revogados (rls_financeiro): apagar
 * a linha faria a próxima "primeira gravação" semear de novo. Só a equipe (staff_only); sem paciente, sem gatilho de auditoria
 * (o módulo grava `recordAudit` da entidade `financeiro_configuracoes`, RN-320).
 */
export const finConfiguracoes = pgTable(
  'fin_configuracoes',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
    saldoInicialCentavos: integer('saldo_inicial_centavos').notNull(),
    saldoInicialEm: date('saldo_inicial_em', { mode: 'string' }).notNull(),
    valorConsultaCentavos: integer('valor_consulta_centavos'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('fin_configuracoes_saldo_faixa', sql`${t.saldoInicialCentavos} between -1000000000 and 1000000000`),
    // o "até hoje" no fuso do consultório é do módulo
    check('fin_configuracoes_saldo_data', sql`${t.saldoInicialEm} >= '2000-01-01'`),
    check('fin_configuracoes_valor_consulta_faixa', sql`${t.valorConsultaCentavos} is null or ${t.valorConsultaCentavos} between 1 and 100000000`),
  ],
);
export type FinConfiguracaoRow = typeof finConfiguracoes.$inferSelect;

/**
 * Plano 20 (spec §9.2, RN-303): categorias por consultório e tipo. "Consultas" (chave `consultas`) é a da cobrança automática:
 * nunca arquivada (CHECK) nem apagada (gatilho fin_categorias_fixas, que também deixa `tipo` e `chave` fixos). Categoria com
 * lançamento não se apaga (FK NO ACTION dos lançamentos): arquiva-se.
 */
export const finCategorias = pgTable(
  'fin_categorias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipo: text('tipo').$type<TipoLancamento>().notNull(),
    nome: text('nome').notNull(),
    chave: text('chave'),
    arquivadaEm: timestamp('arquivada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('fin_categorias_tipo_valido', sql`${t.tipo} in (${lista(TIPOS_DE_LANCAMENTO)})`),
    check('fin_categorias_nome_tamanho', sql`char_length(${t.nome}) between 1 and 60`),
    check('fin_categorias_chave_valida', sql`${t.chave} is null or (${t.chave} = 'consultas' and ${t.tipo} = 'entrada')`),
    check('fin_categorias_chave_nunca_arquivada', sql`${t.chave} is null or ${t.arquivadaEm} is null`),
    // alvo da FK composta dos lançamentos (categoria do mesmo tipo garantida pelo banco)
    unique('fin_categorias_tenant_id_tipo_unique').on(t.tenantId, t.id, t.tipo),
    uniqueIndex('fin_categorias_chave_unique').on(t.tenantId, t.chave).where(sql`${t.chave} is not null`),
    uniqueIndex('fin_categorias_nome_unique').on(t.tenantId, t.tipo, sql`lower(${t.nome})`),
  ],
);
export type FinCategoriaRow = typeof finCategorias.$inferSelect;

/**
 * Plano 20 (spec §9.3, RN-304 a RN-316): entradas e saídas do consultório. A situação é calculada (RN-305): cancelado,
 * recebido/pago (`pago_em`), em atraso ou previsto. Paciente só em entrada; consulta só com paciente (F-D24). `criado_por` e
 * `cancelado_por` vêm do gatilho fin_lancamentos_regras (a usuária da sessão) e não têm FK para `user` (como `enviado_por`:
 * a semente do E2E recria as contas). DELETE revogado; colunas fixas, paciente bloqueado e anonimização no gatilho
 * (rls_financeiro); a anonimização só por app_anonimizar_financeiro.
 */
export const finLancamentos = pgTable(
  'fin_lancamentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipo: text('tipo').$type<TipoLancamento>().notNull(),
    categoriaId: uuid('categoria_id').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    vencimento: date('vencimento', { mode: 'string' }).notNull(),
    pagoEm: date('pago_em', { mode: 'string' }),
    formaPagamento: text('forma_pagamento').$type<FormaPagamento>(),
    descricao: text('descricao'),
    patientId: uuid('patient_id'),
    appointmentId: uuid('appointment_id'),
    criadoPor: uuid('criado_por').notNull(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
    motivoCancelamento: text('motivo_cancelamento'),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('fin_lancamentos_tipo_valido', sql`${t.tipo} in (${lista(TIPOS_DE_LANCAMENTO)})`),
    check('fin_lancamentos_valor_faixa', sql`${t.valorCentavos} between 1 and 100000000`),
    check('fin_lancamentos_vencimento_faixa', sql`${t.vencimento} between '2000-01-01' and '2100-12-31'`),
    check('fin_lancamentos_pago_em_faixa', sql`${t.pagoEm} is null or ${t.pagoEm} between '2000-01-01' and '2100-12-31'`),
    check('fin_lancamentos_forma_valida', sql`${t.formaPagamento} is null or ${t.formaPagamento} in (${lista(FORMAS_DE_PAGAMENTO)})`),
    check('fin_lancamentos_pago_tem_forma', sql`${t.pagoEm} is null or ${t.formaPagamento} is not null`),
    check('fin_lancamentos_descricao_tamanho', sql`${t.descricao} is null or char_length(${t.descricao}) between 1 and 200`),
    check('fin_lancamentos_motivo_tamanho', sql`${t.motivoCancelamento} is null or char_length(${t.motivoCancelamento}) between 1 and 200`),
    check('fin_lancamentos_saida_sem_paciente', sql`${t.tipo} = 'entrada' or ${t.patientId} is null`),
    // sem ela, com patient_id nulo a FK composta da consulta (MATCH SIMPLE) não conferiria nada
    check('fin_lancamentos_consulta_com_paciente', sql`${t.appointmentId} is null or ${t.patientId} is not null`),
    check(
      'fin_lancamentos_cancelamento_coerente',
      sql`(${t.canceladoEm} is null and ${t.canceladoPor} is null and ${t.motivoCancelamento} is null) or (${t.canceladoEm} is not null and (${t.motivoCancelamento} is not null or ${t.anonimizadoEm} is not null))`,
    ),
    check('fin_lancamentos_anonimizado_sem_texto', sql`${t.anonimizadoEm} is null or (${t.descricao} is null and ${t.motivoCancelamento} is null)`),
    foreignKey({ columns: [t.tenantId, t.categoriaId, t.tipo], foreignColumns: [finCategorias.tenantId, finCategorias.id, finCategorias.tipo], name: 'fin_lancamentos_categoria_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'fin_lancamentos_paciente_fk' }),
    foreignKey({
      columns: [t.tenantId, t.patientId, t.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.patientId, appointments.id],
      name: 'fin_lancamentos_consulta_fk',
    }),
    // RN-310 (c): uma cobrança ativa por consulta. Predicado com literais (como tipoUmPorHorario): o `ON CONFLICT … WHERE`
    // da cobrança automática só acha o índice com o mesmo predicado
    uniqueIndex('fin_lancamentos_consulta_ativa_unique').on(t.tenantId, t.appointmentId).where(sql`${t.appointmentId} is not null and ${t.canceladoEm} is null`),
    index('fin_lancamentos_pago_idx').on(t.tenantId, t.pagoEm).where(sql`${t.canceladoEm} is null and ${t.pagoEm} is not null`),
    index('fin_lancamentos_aberto_idx').on(t.tenantId, t.vencimento).where(sql`${t.canceladoEm} is null and ${t.pagoEm} is null`),
    index('fin_lancamentos_paciente_idx').on(t.tenantId, t.patientId, t.vencimento).where(sql`${t.patientId} is not null`),
    // "Últimos lançamentos" do Resumo (order by created_at desc, id desc limit 10): sem ele, top-N da tabela de todos os consultórios
    index('fin_lancamentos_criado_idx').on(t.tenantId, t.createdAt, t.id),
    // a FK composta da categoria é conferida em cada DELETE de fin_categorias: sem ele, varredura dos lançamentos
    index('fin_lancamentos_categoria_idx').on(t.tenantId, t.categoriaId, t.tipo),
  ],
);
export type FinLancamentoRow = typeof finLancamentos.$inferSelect;
