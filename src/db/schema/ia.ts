import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ResultadoLeitura } from '@/modules/ia/tipos';
import { patients } from './pacientes';
import { tenants } from './platform';

/**
 * Plano 11 (spec v0.3 §11): um pedido à IA. Dado de saúde em `resultado` (só até a decisão da nutricionista ou 7 dias);
 * o resto é registro técnico que fica (§5.11: nada é apagado de vez fora da anonimização — gatilho ia_tarefas_sem_apagar,
 * 0099). A FK composta para `exams` (`ON DELETE SET NULL (exam_id)`) fica só na migration custom 0099: o Drizzle não
 * declara a lista de colunas do SET NULL.
 */
export const iaTarefas = pgTable(
  'ia_tarefas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull(),
    status: text('status').notNull().default('na_fila'),
    examId: uuid('exam_id'),
    /** Quem pediu (ator da sessão). RN-103: conta os pedidos da última hora. */
    pedidoPor: uuid('pedido_por').notNull(),
    /** Plano 14 (opções do resumo e do rascunho); nulo na leitura. */
    parametros: jsonb('parametros'),
    resultado: jsonb('resultado').$type<ResultadoLeitura>(),
    /** Motivo da RN-112, só em `falhou`. */
    erro: text('erro'),
    modelo: text('modelo').notNull(),
    promptVersao: text('prompt_versao').notNull(),
    tentativas: integer('tentativas').notNull().default(0),
    reservaMicroUsd: bigint('reserva_micro_usd', { mode: 'number' }).notNull(),
    custoMicroUsd: bigint('custo_micro_usd', { mode: 'number' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    /** D4: gravado e confirmado no portão do envio, ANTES da chamada; nova tentativa com ele preenchido = resultado incerto, sem reenviar. */
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    /** D4 / RN-101: a PRIMEIRA saída do laudo ao provedor (registro conservador; nunca volta a nulo). Vai à exportação do titular. */
    saiuEm: timestamp('saiu_em', { withTimezone: true }),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    expiraEm: timestamp('expira_em', { withTimezone: true }),
    /** §5.11 / ECF.17.01: quem aplicou, descartou ou cancelou, e quando. */
    encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
    encerradoPor: uuid('encerrado_por'),
    linhasAplicadas: integer('linhas_aplicadas'),
    /** RN-114 / ECF.17.03: a data do exame antes de "Usar esta data ao salvar". */
    exameDataAnterior: date('exame_data_anterior', { mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_tarefas_paciente_fk' }),
    check('ia_tarefas_tipo_valido', sql`${t.tipo} in ('leitura_exame')`),
    check('ia_tarefas_status_valido', sql`${t.status} in ('na_fila', 'processando', 'pronta', 'falhou', 'aplicada', 'descartada', 'expirada', 'cancelada')`),
    check('ia_tarefas_exame_so_na_leitura', sql`${t.examId} is null or ${t.tipo} = 'leitura_exame'`),
    check('ia_tarefas_resultado_so_pronta', sql`${t.resultado} is null or ${t.status} = 'pronta'`),
    check('ia_tarefas_conteudo_esvaziado', sql`${t.status} in ('na_fila', 'processando', 'pronta') or (${t.parametros} is null and ${t.resultado} is null)`),
    check('ia_tarefas_erro_so_falhou', sql`(${t.status} = 'falhou') = (${t.erro} is not null)`),
    check('ia_tarefas_erro_tamanho', sql`${t.erro} is null or char_length(${t.erro}) <= 60`),
    check('ia_tarefas_linhas_so_aplicada', sql`(${t.status} = 'aplicada') = (${t.linhasAplicadas} is not null)`),
    check('ia_tarefas_reserva_valida', sql`${t.reservaMicroUsd} >= 0`),
    uniqueIndex('ia_tarefas_em_andamento_idx').on(t.tenantId, t.patientId, t.tipo, t.examId).where(sql`${t.status} in ('na_fila', 'processando')`),
    index('ia_tarefas_pedidos_idx').on(t.tenantId, t.pedidoPor, t.criadoEm),
    index('ia_tarefas_status_idx').on(t.tenantId, t.status),
    index('ia_tarefas_exame_idx').on(t.tenantId, t.patientId, t.examId, t.criadoEm),
  ],
);

export type IaTarefaRow = typeof iaTarefas.$inferSelect;

/**
 * D3: uma linha por tarefa — a reserva (RN-104) que vira o custo real. Sem patient_id e sem conteúdo (registro técnico,
 * fora da auditoria). `tarefa_id` sem FK: sobrevive à anonimização, que apaga a tarefa.
 */
export const iaUso = pgTable(
  'ia_uso',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tarefaId: uuid('tarefa_id').notNull(),
    tipo: text('tipo').notNull(),
    modelo: text('modelo').notNull(),
    promptVersao: text('prompt_versao').notNull(),
    inferenceGeo: text('inference_geo'),
    tokensEntrada: integer('tokens_entrada').notNull().default(0),
    tokensCacheLeitura: integer('tokens_cache_leitura').notNull().default(0),
    tokensCacheGravacao: integer('tokens_cache_gravacao').notNull().default(0),
    tokensSaida: integer('tokens_saida').notNull().default(0),
    custoMicroUsd: bigint('custo_micro_usd', { mode: 'number' }).notNull(),
    situacao: text('situacao').notNull().default('reservado'),
    /** AAAA-MM no fuso do tenant (RN-09). */
    mes: text('mes').notNull(),
    recusaCategoria: text('recusa_categoria'),
    requestId: text('request_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ia_uso_tarefa_idx').on(t.tenantId, t.tarefaId),
    index('ia_uso_mes_idx').on(t.tenantId, t.mes),
    check('ia_uso_situacao_valida', sql`${t.situacao} in ('reservado', 'confirmado', 'incerto', 'estornado')`),
    check('ia_uso_custo_valido', sql`${t.custoMicroUsd} >= 0`),
    check('ia_uso_mes_formato', sql`${t.mes} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('ia_uso_textos_tamanho', sql`(${t.recusaCategoria} is null or char_length(${t.recusaCategoria}) <= 60) and (${t.requestId} is null or char_length(${t.requestId}) <= 200) and (${t.inferenceGeo} is null or char_length(${t.inferenceGeo}) <= 20)`),
  ],
);

export type IaUsoRow = typeof iaUso.$inferSelect;

/**
 * D3: teto global da plataforma (IA_TETO_GLOBAL_MENSAL_USD) — soma de todos os tenants no mês civil de Brasília. Sem
 * tenant_id (fora da RLS, como backup_runs), sem dado de saúde; só src/modules/ia/cota.ts grava (CLAUDE.md regra 1).
 */
export const iaGastoPlataforma = pgTable(
  'ia_gasto_plataforma',
  {
    mes: text('mes').primaryKey(),
    custoMicroUsd: bigint('custo_micro_usd', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ia_gasto_plataforma_valido', sql`${t.custoMicroUsd} >= 0 and ${t.mes} ~ '^[0-9]{4}-[0-9]{2}$'`)],
);
