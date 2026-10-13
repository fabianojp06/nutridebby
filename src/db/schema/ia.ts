import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { AREAS_MODELOS_IA, STATUS_GERACAO } from '../../modules/ia/constantes'; // relativo: o drizzle-kit não resolve o alias @/
import type { ResultadoLeitura } from '@/modules/ia/tipos';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

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
    /** Plano 14A (RN-109): o código do destino gravado no portão do envio, junto da primeira saída; nunca muda (0108). */
    destino: text('destino'),
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
    check('ia_tarefas_destino_valido', sql`${t.destino} is null or (${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste') and ${t.saiuEm} is not null)`),
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

/**
 * Plano 14B (US-123 (d), RN-124, §11): um pedido de pacote de modelos sugeridos (uma área). SEM patient_id — nenhum dado
 * de paciente vai à IA nem fica aqui (`ia_tarefas` não serve: patient_id é obrigatório). RLS por tenant, `staff_only`,
 * DELETE/TRUNCATE revogados (0112): a linha é o registro técnico do pedido; os modelos gerados apontam para ela
 * (`ia_geracao_id`). O custo vai a `ia_uso` (tipo `modelos_area`, `tarefa_id` = este id).
 */
export const iaGeracoesModelos = pgTable(
  'ia_geracoes_modelos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    area: text('area').notNull(),
    status: text('status').notNull().default('na_fila'),
    pedidoPor: uuid('pedido_por').notNull(),
    modelo: text('modelo').notNull(),
    promptVersao: text('prompt_versao').notNull(),
    reservaMicroUsd: bigint('reserva_micro_usd', { mode: 'number' }).notNull(),
    custoMicroUsd: bigint('custo_micro_usd', { mode: 'number' }),
    erro: text('erro'),
    itensDescartados: integer('itens_descartados').notNull().default(0),
    voltas: integer('voltas').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    /** D4: gravado no portão, antes da primeira chamada; nova tentativa com ele preenchido = resultado incerto, sem reenviar. */
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ia_geracoes_modelos_tenant_id_unique').on(t.tenantId, t.id),
    check('ia_geracoes_modelos_area_valida', sql`${t.area} in (${sql.raw(AREAS_MODELOS_IA.map((a) => `'${a}'`).join(', '))})`),
    check('ia_geracoes_modelos_status_valido', sql`${t.status} in (${sql.raw(STATUS_GERACAO.map((s) => `'${s}'`).join(', '))})`),
    check('ia_geracoes_modelos_erro_so_falhou', sql`(${t.status} = 'falhou') = (${t.erro} is not null)`),
    check('ia_geracoes_modelos_erro_tamanho', sql`${t.erro} is null or char_length(${t.erro}) <= 60`),
    check('ia_geracoes_modelos_descartados_valido', sql`${t.itensDescartados} >= 0 and ${t.voltas} >= 0 and ${t.reservaMicroUsd} >= 0`),
    // RN-103 / D19: um pacote em andamento por consultório
    uniqueIndex('ia_geracoes_modelos_em_andamento_idx').on(t.tenantId).where(sql`${t.status} in ('na_fila', 'processando')`),
    index('ia_geracoes_modelos_area_idx').on(t.tenantId, t.area, t.criadoEm),
  ],
);

export type IaGeracaoModelosRow = typeof iaGeracoesModelos.$inferSelect;

/**
 * Plano 14A (spec da IA v0.5.1 §11, RN-107): a autorização (consentimento, LGPD art. 33, VIII) do paciente para o uso de
 * IA — um EVENTO por linha (`autorizou`, `retirou`, `pedido_email`), só inclusão: UPDATE/DELETE/TRUNCATE revogados de
 * nutri_app_role (0108); os dados de identificação e o ponteiro do termo só saem pelas funções SECURITY DEFINER da 0108,
 * no contexto worker. `registrado_em` e, fora do papel, `em` vêm do gatilho ia_autorizacoes_regras (clock_timestamp). Sem
 * o gatilho de auditoria (AUDIT_EXCEPTIONS): a própria linha é a prova, como `consents`. "Papel exige arquivo" e "quem
 * registrou" ficam no gatilho de INSERT, não em CHECK: um CHECK valeria também no UPDATE da anonimização.
 */
export const iaAutorizacoes = pgTable(
  'ia_autorizacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    evento: text('evento').notNull(),
    /** Versão do texto (AUTORIZACAO_IA_VERSAO); nula só em `retirou`. */
    versao: text('versao'),
    /** Só em `autorizou`: lista fechada (USOS_IA). */
    usos: text('usos').array(),
    /** Só em `autorizou`: código estável do destino (RN-109). */
    destino: text('destino'),
    canal: text('canal').notNull(),
    /** O ato (no papel, a data da assinatura informada; nos outros canais, o gatilho grava = registrado_em). */
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Quem registrou: a conta do paciente (app), a nutricionista (papel, nutricionista, pedido_email); nulo no link. Sem FK (como audit_log.actor_user_id). */
    registradoPor: uuid('registrado_por'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** HMAC do e-mail para onde o link foi (nunca o e-mail em claro). */
    emailHmac: text('email_hmac'),
    /** Só no papel: a foto ou o PDF do termo assinado (FK NO ACTION, regra 9). */
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_autorizacoes_paciente_fk' }),
    check('ia_autorizacoes_evento_valido', sql`${t.evento} in ('autorizou', 'retirou', 'pedido_email')`),
    check('ia_autorizacoes_canal_valido', sql`${t.canal} in ('app', 'link', 'papel', 'nutricionista')`),
    check('ia_autorizacoes_versao', sql`(${t.evento} = 'retirou') = (${t.versao} is null) and (${t.versao} is null or char_length(${t.versao}) between 1 and 40)`),
    check(
      'ia_autorizacoes_usos',
      sql`(${t.evento} = 'autorizou') = (${t.usos} is not null) and (${t.usos} is null or (cardinality(${t.usos}) > 0 and ${t.usos} <@ array['leitura_laudos', 'resumo_historico', 'rascunho_plano']::text[]))`,
    ),
    check('ia_autorizacoes_destino', sql`(${t.evento} = 'autorizou') = (${t.destino} is not null) and (${t.destino} is null or ${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste'))`),
    check(
      'ia_autorizacoes_canal_do_evento',
      sql`(${t.evento} <> 'pedido_email' or ${t.canal} = 'link') and (${t.evento} <> 'retirou' or ${t.canal} <> 'papel') and (${t.evento} <> 'autorizou' or ${t.canal} <> 'nutricionista')`,
    ),
    check('ia_autorizacoes_em', sql`${t.em} <= ${t.registradoEm}`),
    check('ia_autorizacoes_link_sem_conta', sql`not (${t.canal} = 'link' and ${t.evento} <> 'pedido_email') or ${t.registradoPor} is null`),
    check(
      'ia_autorizacoes_ip_so_digital',
      sql`(${t.ip} is null and ${t.userAgent} is null) or (${t.canal} in ('app', 'link') and ${t.evento} <> 'pedido_email')`,
    ),
    check('ia_autorizacoes_tamanhos', sql`(${t.ip} is null or char_length(${t.ip}) <= 45) and (${t.userAgent} is null or char_length(${t.userAgent}) <= 300) and (${t.emailHmac} is null or char_length(${t.emailHmac}) <= 64)`),
    check('ia_autorizacoes_hmac_so_link', sql`${t.emailHmac} is null or ${t.canal} = 'link'`),
    check(
      'ia_autorizacoes_arquivo_so_papel',
      sql`${t.arquivoPath} is null or (${t.canal} = 'papel' and ${t.evento} = 'autorizou' and ${t.arquivoPath} like ${t.tenantId}::text || '/ia_autorizacao_termo/%')`,
    ),
    index('ia_autorizacoes_paciente_idx').on(t.tenantId, t.patientId, t.registradoEm),
  ],
);

export type IaAutorizacaoRow = typeof iaAutorizacoes.$inferSelect;
