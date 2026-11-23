import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { REFEICOES_DO_DIARIO } from '../../modules/portal/diario-constantes'; // relativo: o drizzle-kit não resolve o alias @/
import type { Pergunta, Resposta } from '@/modules/pacientes/anamnese-tipos';
import { appointments } from './agenda';
import { foods } from './alimentos';
import { anamnesisTemplates, patients } from './pacientes';
import type { MedidaDoItem, NutrientesCongelados } from './plano-alimentar';
import { tenants } from './platform';

/**
 * Plano 27 (spec §9.2): questionário pré-consulta enviado ao paciente. A cópia do modelo (`modelo_snapshot`) é o que o
 * paciente responde — arquivar ou editar o modelo depois não muda o envio. O paciente (com e sem login) só responde, por
 * UPDATE (RN-529); as transições por papel ficam no gatilho questionario_envios_regras (custom do PR 1). Auditada como
 * `questionario` ("Questionário pré-consulta"); a resposta também grava `questionario_resposta` pelo módulo (QP-D36).
 * Respostas, nome do modelo e perguntas nunca vão a push, e-mail, URL, log, Sentry ou audit_log (RN-551).
 */
export const SITUACOES_ENVIO = ['enviado', 'respondido', 'cancelado', 'expirado'] as const;
export type SituacaoEnvio = (typeof SITUACOES_ENVIO)[number];
export const ORIGENS_ENVIO = ['nutri', 'automatico'] as const;
export type OrigemEnvio = (typeof ORIGENS_ENVIO)[number];
export const MOTIVOS_CANCELAMENTO = ['nutri', 'consulta_cancelada', 'paciente_bloqueado'] as const;
export type MotivoCancelamento = (typeof MOTIVOS_CANCELAMENTO)[number];
export const VIAS_RESPOSTA = ['app', 'link'] as const;
export type ViaResposta = (typeof VIAS_RESPOSTA)[number];
export type SnapshotQuestionario = { nome: string; introducao?: string; perguntas: Pergunta[] };

const lista = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(', '));

/**
 * Um envio aberto (enviado ou respondido) por consulta: o predicado do índice `questionario_envios_um_por_consulta`. O
 * `ON CONFLICT` do envio automático (T5) repete a mesma expressão, com constantes (um parâmetro no predicado impediria o
 * Postgres de casar o índice parcial).
 */
const umPorConsultaOnde = (appointmentId: AnyPgColumn | SQL, situacao: AnyPgColumn | SQL) =>
  sql`${appointmentId} is not null and ${situacao} in ('enviado', 'respondido')`;

export const questionarioEnvios = pgTable(
  'questionario_envios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    /** A consulta a que o questionário se refere (nulo no envio avulso). */
    appointmentId: uuid('appointment_id'),
    /** O modelo de origem (só informativo: arquivar não apaga; o que vale é o snapshot). */
    modeloId: uuid('modelo_id'),
    modeloSnapshot: jsonb('modelo_snapshot').$type<SnapshotQuestionario>().notNull(),
    origem: text('origem').$type<OrigemEnvio>().notNull(),
    /** A usuária da sessão no envio manual; nulo no automático. Sem FK, como audit_log.actor_user_id. */
    enviadoPor: uuid('enviado_por'),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    situacao: text('situacao').$type<SituacaoEnvio>().notNull().default('enviado'),
    respostas: jsonb('respostas').$type<Record<string, Resposta>>(),
    /** Gravado pelo gatilho (clock_timestamp()), nunca pelo valor mandado. */
    respondidoEm: timestamp('respondido_em', { withTimezone: true }),
    respondidoVia: text('respondido_via').$type<ViaResposta>(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
    canceladoMotivo: text('cancelado_motivo').$type<MotivoCancelamento>(),
    /**
     * A anamnese para a qual as respostas foram copiadas (uma vez, RN-531). A FK composta `questionario_envios_anamnese_fk`
     * (tenant_id, patient_id, anamnese_id) → anamneses (tenant_id, patient_id, id) fica só na migration custom: o drizzle-kit
     * cria o UNIQUE novo de `anamneses` (tabela existente) depois das FKs, e a FK na gerada falharia (42830).
     */
    anamneseId: uuid('anamnese_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('questionario_envios_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'questionario_envios_paciente_fk' }),
    // MATCH SIMPLE: com appointment_id, modelo_id ou anamnese_id nulos, a FK não é conferida
    foreignKey({ columns: [t.tenantId, t.patientId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.patientId, appointments.id], name: 'questionario_envios_consulta_fk' }),
    foreignKey({ columns: [t.tenantId, t.modeloId], foreignColumns: [anamnesisTemplates.tenantId, anamnesisTemplates.id], name: 'questionario_envios_modelo_fk' }),
    check('questionario_envios_snapshot_objeto', sql`jsonb_typeof(${t.modeloSnapshot}) = 'object'`),
    check('questionario_envios_origem_valida', sql`${t.origem} in (${lista(ORIGENS_ENVIO)})`),
    check('questionario_envios_origem_coerente', sql`(${t.origem} = 'nutri') = (${t.enviadoPor} is not null)`),
    check('questionario_envios_prazo', sql`${t.expiraEm} > ${t.enviadoEm}`),
    check('questionario_envios_situacao_valida', sql`${t.situacao} in (${lista(SITUACOES_ENVIO)})`),
    check('questionario_envios_respostas_tamanho', sql`${t.respostas} is null or (jsonb_typeof(${t.respostas}) = 'object' and octet_length(${t.respostas}::text) <= 2000000)`),
    check('questionario_envios_via_valida', sql`${t.respondidoVia} in (${lista(VIAS_RESPOSTA)})`),
    check('questionario_envios_resposta_coerente', sql`(${t.situacao} = 'respondido') = (${t.respostas} is not null and ${t.respondidoEm} is not null and ${t.respondidoVia} is not null)`),
    check('questionario_envios_motivo_valido', sql`${t.canceladoMotivo} in (${lista(MOTIVOS_CANCELAMENTO)})`),
    check('questionario_envios_cancelamento_coerente', sql`(${t.situacao} = 'cancelado') = (${t.canceladoEm} is not null and ${t.canceladoMotivo} is not null)`),
    check('questionario_envios_cancelado_pela_nutri', sql`${t.canceladoMotivo} is distinct from 'nutri' or ${t.canceladoPor} is not null`),
    check('questionario_envios_anamnese_so_respondido', sql`${t.anamneseId} is null or ${t.situacao} = 'respondido'`),
    uniqueIndex('questionario_envios_uma_anamnese').on(t.anamneseId).where(sql`${t.anamneseId} is not null`),
    uniqueIndex('questionario_envios_um_por_consulta').on(t.tenantId, t.appointmentId).where(umPorConsultaOnde(t.appointmentId, t.situacao)),
    index('questionario_envios_paciente_idx').on(t.tenantId, t.patientId, t.enviadoEm.desc()),
    // o worker: envios abertos que vencem
    index('questionario_envios_abertos_idx').on(t.tenantId, t.expiraEm).where(sql`${t.situacao} = 'enviado'`),
  ],
);
export type QuestionarioEnvioRow = typeof questionarioEnvios.$inferSelect;

/** Alvo do `INSERT … ON CONFLICT DO NOTHING` no índice `questionario_envios_um_por_consulta` (mesma expressão e WHERE). */
export const UM_POR_CONSULTA = {
  target: [questionarioEnvios.tenantId, questionarioEnvios.appointmentId],
  where: umPorConsultaOnde(questionarioEnvios.appointmentId, questionarioEnvios.situacao),
};

/**
 * Plano 27 (spec §9.3): recordatório alimentar de 24 h, registrado pela nutricionista (o portal não lê na v1, QP-D16).
 * Não se apaga (QP-D17: REVOKE DELETE); `criado_por` é gravado pelo gatilho recordatorios_regras. Auditada como
 * `recordatorio` ("Recordatório alimentar").
 */
export const recordatorios = pgTable(
  'recordatorios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    diaRelatado: date('dia_relatado', { mode: 'string' }).notNull(),
    diaAtipico: boolean('dia_atipico').notNull().default(false),
    observacao: text('observacao'),
    /** A usuária da sessão (autoria, SBIS), gravada pelo gatilho. Sem FK, como audit_log.actor_user_id. */
    criadoPor: uuid('criado_por').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('recordatorios_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'recordatorios_paciente_fk' }),
    check('recordatorios_observacao_tamanho', sql`${t.observacao} is null or char_length(${t.observacao}) between 1 and 2000`),
    index('recordatorios_paciente_idx').on(t.tenantId, t.patientId, t.diaRelatado.desc()),
  ],
);
export type RecordatorioRow = typeof recordatorios.$inferSelect;

/**
 * Plano 27 (spec §9.3): os itens do recordatório. `id` gerado no cliente (como meal_items); a edição apaga os itens que
 * saíram (sem REVOKE DELETE). `nutrientes` congelados ao salvar (RN-541); `food_id` RESTRICT: o "Meu alimento" usado não
 * se exclui (QP-D38). Auditada como `recordatorio_item`, fora do Histórico (QP-D36).
 */
export const recordatorioItens = pgTable(
  'recordatorio_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    recordatorioId: uuid('recordatorio_id').notNull(),
    refeicao: text('refeicao').notNull(),
    refeicaoNome: text('refeicao_nome'),
    horario: time('horario'),
    local: text('local'),
    foodId: uuid('food_id').references(() => foods.id, { onDelete: 'restrict' }),
    /** Cópia do nome do alimento ao salvar. */
    alimentoNome: text('alimento_nome'),
    quantidadeG: numeric('quantidade_g', { precision: 7, scale: 2, mode: 'number' }),
    medida: jsonb('medida').$type<MedidaDoItem>(),
    medidaCaseiraTxt: text('medida_caseira_txt'),
    nutrientes: jsonb('nutrientes').$type<NutrientesCongelados>(),
    /** Item sem cadastro (o texto é o item) ou o preparo do item com alimento. */
    descricao: text('descricao'),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.patientId, t.recordatorioId],
      foreignColumns: [recordatorios.tenantId, recordatorios.patientId, recordatorios.id],
      name: 'recordatorio_itens_recordatorio_fk',
    }).onDelete('cascade'),
    check('recordatorio_itens_refeicao_valida', sql`${t.refeicao} in (${lista(REFEICOES_DO_DIARIO)})`),
    check('recordatorio_itens_refeicao_nome', sql`(${t.refeicao} = 'Outro') = (${t.refeicaoNome} is not null) and (${t.refeicaoNome} is null or char_length(${t.refeicaoNome}) between 2 and 40)`),
    check('recordatorio_itens_local_tamanho', sql`${t.local} is null or char_length(${t.local}) between 2 and 60`),
    check('recordatorio_itens_alimento_nome_tamanho', sql`${t.alimentoNome} is null or char_length(${t.alimentoNome}) between 2 and 200`),
    check('recordatorio_itens_quantidade_faixa', sql`${t.quantidadeG} is null or ${t.quantidadeG} between 0.1 and 5000`),
    // 1–200 (preparo do item com alimento); sem cadastro, 2–120
    check('recordatorio_itens_descricao_tamanho', sql`${t.descricao} is null or (char_length(${t.descricao}) between 1 and 200 and (${t.alimentoNome} is not null or char_length(${t.descricao}) between 2 and 120))`),
    check(
      'recordatorio_itens_tipo',
      sql`(${t.alimentoNome} is not null and ${t.quantidadeG} is not null) or (${t.foodId} is null and ${t.alimentoNome} is null and ${t.quantidadeG} is null and ${t.nutrientes} is null and ${t.descricao} is not null)`,
    ),
    index('recordatorio_itens_recordatorio_idx').on(t.tenantId, t.recordatorioId, t.ordem),
    index('recordatorio_itens_alimento_idx').on(t.foodId),
  ],
);
export type RecordatorioItemRow = typeof recordatorioItens.$inferSelect;

/** Plano 27 (spec §9.4): categorias das metas e os tipos de lembrete do Plano 17 que a meta sugere. */
export const CATEGORIAS_META = ['agua', 'alimentacao', 'atividade', 'sono', 'habitos', 'outra'] as const;
export type CategoriaMeta = (typeof CATEGORIAS_META)[number];
export const SITUACOES_META = ['ativa', 'alcancada', 'encerrada'] as const;
export type SituacaoMeta = (typeof SITUACOES_META)[number];
export const LEMBRETES_SUGERIDOS = ['agua', 'refeicoes', 'suplemento', 'livre'] as const;
export type LembreteSugerido = (typeof LEMBRETES_SUGERIDOS)[number];

/** Plano 27 (spec §9.4): biblioteca de metas do consultório (STAFF_ONLY; sem paciente, sem auditoria). */
export const metasModelos = pgTable(
  'metas_modelos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    titulo: text('titulo').notNull(),
    comoFazer: text('como_fazer'),
    categoria: text('categoria').$type<CategoriaMeta>().notNull(),
    lembreteSugerido: text('lembrete_sugerido').$type<LembreteSugerido>(),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('metas_modelos_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('metas_modelos_titulo_unico').on(t.tenantId, sql`lower(${t.titulo})`).where(sql`${t.arquivadoEm} is null`),
    check('metas_modelos_titulo_tamanho', sql`char_length(${t.titulo}) between 3 and 80`),
    check('metas_modelos_como_fazer_tamanho', sql`${t.comoFazer} is null or char_length(${t.comoFazer}) between 1 and 300`),
    check('metas_modelos_categoria_valida', sql`${t.categoria} in (${lista(CATEGORIAS_META)})`),
    check('metas_modelos_lembrete_valido', sql`${t.lembreteSugerido} in (${lista(LEMBRETES_SUGERIDOS)})`),
  ],
);
export type MetaModeloRow = typeof metasModelos.$inferSelect;

/**
 * Plano 27 (spec §9.4): a meta do paciente (cópia do modelo, quando veio de um). Não se apaga (REVOKE DELETE); só a sessão
 * `nutri` (e o contexto vazio) grava, pelo gatilho metas_paciente_regras — o paciente nunca recebe `update` aqui (QP-D34).
 * Auditada como `metas` ("Metas").
 */
export const metasPaciente = pgTable(
  'metas_paciente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    /** O modelo de origem (só informativo, sem FK). */
    modeloId: uuid('modelo_id'),
    titulo: text('titulo').notNull(),
    comoFazer: text('como_fazer'),
    categoria: text('categoria').$type<CategoriaMeta>().notNull(),
    lembreteSugerido: text('lembrete_sugerido').$type<LembreteSugerido>(),
    inicio: date('inicio', { mode: 'string' }).notNull(),
    fim: date('fim', { mode: 'string' }),
    situacao: text('situacao').$type<SituacaoMeta>().notNull().default('ativa'),
    encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
    /** A usuária da sessão, gravada pelo gatilho. Sem FK, como audit_log.actor_user_id. */
    criadoPor: uuid('criado_por').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('metas_paciente_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'metas_paciente_paciente_fk' }),
    check('metas_paciente_titulo_tamanho', sql`char_length(${t.titulo}) between 3 and 80`),
    check('metas_paciente_como_fazer_tamanho', sql`${t.comoFazer} is null or char_length(${t.comoFazer}) between 1 and 300`),
    check('metas_paciente_categoria_valida', sql`${t.categoria} in (${lista(CATEGORIAS_META)})`),
    check('metas_paciente_lembrete_valido', sql`${t.lembreteSugerido} in (${lista(LEMBRETES_SUGERIDOS)})`),
    check('metas_paciente_fim_faixa', sql`${t.fim} is null or (${t.fim} >= ${t.inicio} and ${t.fim} <= ${t.inicio} + 365)`),
    check('metas_paciente_situacao_valida', sql`${t.situacao} in (${lista(SITUACOES_META)})`),
    check('metas_paciente_encerramento_coerente', sql`(${t.situacao} = 'ativa') = (${t.encerradaEm} is null)`),
    index('metas_paciente_ativas_idx').on(t.tenantId, t.patientId).where(sql`${t.situacao} = 'ativa'`),
  ],
);
export type MetaPacienteRow = typeof metasPaciente.$inferSelect;

/**
 * Plano 27 (spec §9.4, RN-547): o registro diário da meta, pelo paciente com login (hoje ou ontem, no fuso do tenant).
 * Só `cumprida` muda; sem DELETE. `registrado_em` e `atualizado_em` vêm do relógio do banco (gatilho
 * metas_registros_regras). Auditada como `metas_registro` ("Registrou meta").
 */
export const metasRegistros = pgTable(
  'metas_registros',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    metaId: uuid('meta_id').notNull(),
    dia: date('dia', { mode: 'string' }).notNull(),
    cumprida: boolean('cumprida').notNull(),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId, t.metaId], foreignColumns: [metasPaciente.tenantId, metasPaciente.patientId, metasPaciente.id], name: 'metas_registros_meta_fk' }),
    uniqueIndex('metas_registros_um_por_dia').on(t.tenantId, t.metaId, t.dia),
    index('metas_registros_meta_idx').on(t.tenantId, t.metaId, t.dia.desc()),
  ],
);
export type MetaRegistroRow = typeof metasRegistros.$inferSelect;
