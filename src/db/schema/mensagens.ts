import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

/** Plano 25 (spec §9): listas de valores das tabelas do chat e dos recados (os CHECKs repetem as mesmas listas). */
export const AUTORES_CHAT = ['nutri', 'paciente'] as const;
export const STATUS_ANEXO = ['sem_anexo', 'processando', 'pronto', 'falhou', 'removido'] as const; // CH-D41
export const TIPOS_ANEXO = ['imagem', 'pdf'] as const;
export const FORMAS_TCLE = ['termo_assinado', 'aceite_escrito'] as const; // CH-D3 (v0.2)
export const LADOS_LEITURA = ['consultorio', 'paciente'] as const;
export const RISCOS_CHAT = ['emergencia', 'sintoma_agudo', 'transtorno_alimentar'] as const;
export const TIPOS_FILTRO_RECADO = ['todos', 'etiquetas', 'local'] as const;

export type AutorChat = (typeof AUTORES_CHAT)[number];
export type StatusAnexo = (typeof STATUS_ANEXO)[number];
export type TipoAnexo = (typeof TIPOS_ANEXO)[number];
export type FormaTcle = (typeof FORMAS_TCLE)[number];
export type LadoLeitura = (typeof LADOS_LEITURA)[number];
export type RiscoChat = (typeof RISCOS_CHAT)[number];
export type TipoFiltroRecado = (typeof TIPOS_FILTRO_RECADO)[number];

/**
 * Plano 25 (spec §9.1, RN-441, RN-442): a conversa da nutricionista com o paciente — uma por paciente e consultório.
 * Liberada = `liberada_em` preenchida (com quem liberou e a forma do TCLE de telenutrição); pausada = `pausada_em`.
 * `liberada_por`/`pausada_por` sem FK, como audit_log.actor_user_id. FK para `patients` NO ACTION (o titular com conversa
 * não se apaga; a conversa sai só por app_chat_apagar_do_titular). Auditada como `chat_conversa` (fora da tela; os atos
 * vão por recordAudit, CH-D39). DELETE e TRUNCATE revogados (custom rls_mensagens).
 */
export const chatConversas = pgTable(
  'chat_conversas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    liberadaEm: timestamp('liberada_em', { withTimezone: true }),
    liberadaPor: uuid('liberada_por'),
    tcleForma: text('tcle_forma'),
    pausadaEm: timestamp('pausada_em', { withTimezone: true }),
    pausadaPor: uuid('pausada_por'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('chat_conversas_paciente_unique').on(t.tenantId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'chat_conversas_paciente_fk' }).onDelete('no action'),
    check(
      'chat_conversas_liberacao',
      sql`(${t.liberadaEm} is null) = (${t.liberadaPor} is null) and (${t.liberadaEm} is null) = (${t.tcleForma} is null)`,
    ),
    check('chat_conversas_tcle_forma_valida', sql`${t.tcleForma} is null or ${t.tcleForma} in ('termo_assinado', 'aceite_escrito')`),
    check('chat_conversas_pausa', sql`(${t.pausadaEm} is null) = (${t.pausadaPor} is null)`),
    check('chat_conversas_pausa_so_liberada', sql`${t.pausadaEm} is null or ${t.liberadaEm} is not null`),
  ],
);
export type ChatConversaRow = typeof chatConversas.$inferSelect;

/**
 * Plano 25 (spec §9.2): os recados do consultório (sem `patient_id`; cada cópia vai para `chat_mensagens` com `recado_id`).
 * `filtro_rotulo` é gravado no envio, para o histórico não depender de etiqueta renomeada ou apagada. Carimbo profissional
 * (`autor_nome`, `autor_crn`, RN-475) obrigatório. staff_only; UPDATE, DELETE e TRUNCATE revogados. Sem auditoria (sem
 * paciente; cada cópia em chat_mensagens é auditada). `criado_em` com o relógio do banco (CH-D67).
 */
export const recados = pgTable(
  'recados',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    texto: text('texto').notNull(),
    filtro: jsonb('filtro').notNull(),
    filtroRotulo: text('filtro_rotulo'),
    destinatarios: integer('destinatarios').notNull(),
    autorNome: text('autor_nome').notNull(),
    autorCrn: text('autor_crn').notNull(),
    /** Quem enviou (a usuária da sessão). Sem FK, como audit_log.actor_user_id. */
    criadoPor: uuid('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    unique('recados_tenant_id_unique').on(t.tenantId, t.id),
    check('recados_texto_tamanho', sql`char_length(btrim(${t.texto})) between 1 and 1000`),
    // o filtro sem "tipo" (NULL no IN) é recusado por recados_filtro_com_tipo, na custom rls_mensagens
    check('recados_filtro_valido', sql`${t.filtro} ->> 'tipo' in ('todos', 'etiquetas', 'local')`),
    check('recados_filtro_rotulo_tamanho', sql`${t.filtroRotulo} is null or char_length(${t.filtroRotulo}) between 1 and 300`),
    check('recados_destinatarios_positivo', sql`${t.destinatarios} > 0`),
    index('recados_tenant_criado_idx').on(t.tenantId, t.criadoEm),
  ],
);
export type RecadoRow = typeof recados.$inferSelect;

/**
 * Plano 25 (spec §9.2, RN-443 a RN-449, RN-475): as mensagens. Texto e/ou um anexo (CH-D41: `sem_anexo` → `processando`
 * → `pronto` | `falhou` → `removido`). O paciente grava só texto ou o original da foto (`processando`); o PDF é só da
 * nutricionista. Carimbo (`autor_nome`, `autor_crn`) em toda mensagem da nutricionista. `criada_em` com o relógio do banco
 * (CH-D67). Auditada como `chat`; UPDATE só das colunas do anexo (GRANT de colunas), DELETE e TRUNCATE revogados.
 */
export const chatMensagens = pgTable(
  'chat_mensagens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    autor: text('autor').notNull(),
    /** = app_current_user(). Sem FK, como audit_log.actor_user_id. */
    autorUserId: uuid('autor_user_id').notNull(),
    autorNome: text('autor_nome'),
    autorCrn: text('autor_crn'),
    texto: text('texto'),
    recadoId: uuid('recado_id'),
    duvidaEm: timestamp('duvida_em', { withTimezone: true }),
    risco: text('risco'),
    anexoStatus: text('anexo_status').notNull().default('sem_anexo'),
    anexoPath: text('anexo_path').references(() => storedFiles.caminho, { onDelete: 'no action' }),
    anexoOriginalPath: text('anexo_original_path').references(() => storedFiles.caminho, { onDelete: 'no action' }),
    anexoTipo: text('anexo_tipo'),
    anexoNome: text('anexo_nome'),
    anexoBytes: integer('anexo_bytes'),
    criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [chatConversas.tenantId, chatConversas.patientId], name: 'chat_mensagens_conversa_fk' }).onDelete('no action'),
    foreignKey({ columns: [t.tenantId, t.recadoId], foreignColumns: [recados.tenantId, recados.id], name: 'chat_mensagens_recado_fk' }).onDelete('no action'),
    unique('chat_mensagens_anexo_path_unique').on(t.anexoPath),
    unique('chat_mensagens_anexo_original_path_unique').on(t.anexoOriginalPath),
    check('chat_mensagens_autor_valido', sql`${t.autor} in ('nutri', 'paciente')`),
    check('chat_mensagens_texto_tamanho', sql`${t.texto} is null or char_length(btrim(${t.texto})) between 1 and 2000`),
    check('chat_mensagens_tem_conteudo', sql`${t.texto} is not null or ${t.anexoStatus} <> 'sem_anexo'`),
    check('chat_mensagens_anexo_status_valido', sql`${t.anexoStatus} in ('sem_anexo', 'processando', 'pronto', 'falhou', 'removido')`),
    check('chat_mensagens_anexo_tipo_valido', sql`${t.anexoTipo} is null or ${t.anexoTipo} in ('imagem', 'pdf')`),
    check('chat_mensagens_anexo_tipo_com_anexo', sql`(${t.anexoStatus} = 'sem_anexo') = (${t.anexoTipo} is null)`),
    check('chat_mensagens_pronto_com_caminho', sql`${t.anexoStatus} <> 'pronto' or ${t.anexoPath} is not null`),
    check('chat_mensagens_processando_com_original', sql`${t.anexoStatus} <> 'processando' or ${t.anexoOriginalPath} is not null or ${t.anexoTipo} = 'pdf'`),
    check('chat_mensagens_pdf_so_da_nutri', sql`${t.anexoTipo} <> 'pdf' or ${t.autor} = 'nutri'`),
    check('chat_mensagens_recado_so_texto', sql`${t.recadoId} is null or (${t.autor} = 'nutri' and ${t.anexoStatus} = 'sem_anexo')`),
    check('chat_mensagens_removido_sem_caminho', sql`${t.anexoStatus} <> 'removido' or (${t.anexoPath} is null and ${t.anexoOriginalPath} is null)`),
    // CH-D60: sem ele, o paciente gravaria `sem_anexo` apontando um original, e o arquivo escaparia da varredura
    check('chat_mensagens_sem_anexo_sem_caminho', sql`${t.anexoStatus} <> 'sem_anexo' or (${t.anexoPath} is null and ${t.anexoOriginalPath} is null)`),
    check(
      'chat_mensagens_carimbo',
      sql`(${t.autor} = 'nutri' and ${t.autorNome} is not null and ${t.autorCrn} is not null) or (${t.autor} = 'paciente' and ${t.autorNome} is null and ${t.autorCrn} is null)`,
    ),
    check('chat_mensagens_duvida_so_da_nutri', sql`${t.duvidaEm} is null or (${t.autor} = 'nutri' and ${t.recadoId} is null)`),
    check('chat_mensagens_risco_valido', sql`${t.risco} is null or (${t.autor} = 'paciente' and ${t.risco} in ('emergencia', 'sintoma_agudo', 'transtorno_alimentar'))`),
    check('chat_mensagens_anexo_nome', sql`${t.anexoNome} is null or (${t.autor} = 'nutri' and char_length(${t.anexoNome}) between 1 and 120)`),
    check('chat_mensagens_anexo_bytes_positivo', sql`${t.anexoBytes} is null or ${t.anexoBytes} > 0`),
    check('chat_mensagens_anexo_path_prefixo', sql`${t.anexoPath} is null or ${t.anexoPath} like ${t.tenantId}::text || '/chat_anexo/%'`),
    check(
      'chat_mensagens_anexo_original_prefixo',
      sql`${t.anexoOriginalPath} is null or ${t.anexoOriginalPath} like ${t.tenantId}::text || '/chat_anexo_original/%'`,
    ),
    index('chat_mensagens_conversa_idx').on(t.tenantId, t.patientId, t.criadaEm, t.id),
    // caixa e contador (RN-450): só as do paciente
    index('chat_mensagens_do_paciente_idx').on(t.tenantId, t.criadaEm).where(sql`${t.autor} = 'paciente'`),
    index('chat_mensagens_recado_idx').on(t.tenantId, t.recadoId).where(sql`${t.recadoId} is not null`),
    index('chat_mensagens_processando_idx').on(t.tenantId, t.anexoStatus).where(sql`${t.anexoStatus} = 'processando'`),
  ],
);
export type ChatMensagemRow = typeof chatMensagens.$inferSelect;

/**
 * Plano 25 (spec §9.3, RN-448): marcador técnico de até onde cada lado leu. Sem gatilho de auditoria (AUDIT_EXCEPTIONS;
 * a leitura do conteúdo é auditada por auditRead). O paciente grava só o lado `paciente` (paciente_leitura_propria_*).
 * DELETE e TRUNCATE revogados.
 */
export const chatLeituras = pgTable(
  'chat_leituras',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    lado: text('lado').notNull(),
    lidaAte: timestamp('lida_ate', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'chat_leituras_pk', columns: [t.tenantId, t.patientId, t.lado] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [chatConversas.tenantId, chatConversas.patientId], name: 'chat_leituras_conversa_fk' }).onDelete('no action'),
    check('chat_leituras_lado_valido', sql`${t.lado} in ('consultorio', 'paciente')`),
  ],
);
export type ChatLeituraRow = typeof chatLeituras.$inferSelect;

/**
 * Plano 25 (spec §9.4, RN-457): configuração das mensagens do consultório (uma linha por tenant). A sessão de paciente lê
 * (o módulo projeta só `horario_ativo`); escrita só da equipe. CH-D70: as colunas do aviso à nutricionista ficam em
 * `chat_avisos_nutri` (staff_only), não aqui.
 */
export const chatConfiguracoes = pgTable('chat_configuracoes', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  horarioAtivo: boolean('horario_ativo').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ChatConfiguracaoRow = typeof chatConfiguracoes.$inferSelect;

/**
 * Plano 25 (RN-458; CH-D70, decisão da orquestradora em 23/11/2026): o aviso por e-mail à nutricionista de mensagens novas —
 * a preferência (`aviso_email`, ligada por padrão) e a marca do último envio (`aviso_nutri_em`, no máximo um a cada 2 h).
 * Tabela só da equipe (staff_only): pela data da marca, um paciente saberia que outro paciente escreveu nas últimas 2 h. A
 * linha nasce em app_chat_aviso_nutri_devido (SECURITY DEFINER, no envio do paciente) ou na configuração da nutricionista.
 * DELETE e TRUNCATE revogados (apagar a linha religaria o e-mail e zeraria a janela).
 */
export const chatAvisosNutri = pgTable('chat_avisos_nutri', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  avisoEmail: boolean('aviso_email').notNull().default(true),
  avisoNutriEm: timestamp('aviso_nutri_em', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ChatAvisoNutriRow = typeof chatAvisosNutri.$inferSelect;

/**
 * Plano 25 (spec §9.4, RN-457): as faixas do horário de atendimento por mensagens, em minutos do dia no fuso do consultório
 * (múltiplos de 15). Sem sobreposição no mesmo dia: EXCLUDE USING gist na custom rls_mensagens (o Drizzle não o escreve).
 * No máximo 3 por dia (módulo).
 */
export const chatHorarios = pgTable(
  'chat_horarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    diaSemana: smallint('dia_semana').notNull(),
    inicioMin: smallint('inicio_min').notNull(),
    fimMin: smallint('fim_min').notNull(),
  },
  (t) => [
    check('chat_horarios_dia_valido', sql`${t.diaSemana} between 0 and 6`),
    check(
      'chat_horarios_faixa_valida',
      sql`${t.inicioMin} between 0 and 1440 and ${t.fimMin} between 0 and 1440 and ${t.inicioMin} < ${t.fimMin} and ${t.inicioMin} % 15 = 0 and ${t.fimMin} % 15 = 0`,
    ),
  ],
);
export type ChatHorarioRow = typeof chatHorarios.$inferSelect;
