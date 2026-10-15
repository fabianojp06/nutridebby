import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { tenants } from './platform';

/**
 * Plano 15 (spec F3-02 v0.4 §13.1, D6): a liberação da IA Nutri paciente por paciente, pela nutricionista. Sem contadores
 * (os limites contam ia_nutri_mensagens) e sem consentimento (o estado é o último evento de ia_nutri_consentimentos).
 * Liberado = `liberada_em` preenchida e `bloqueada_em` nula. Auditada como `ia_nutri_liberacao` (RN-183).
 */
export const iaNutriParticipacoes = pgTable(
  'ia_nutri_participacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    liberadaEm: timestamp('liberada_em', { withTimezone: true }),
    /** Quem liberou (a nutricionista da sessão). Sem FK, como audit_log.actor_user_id. */
    liberadaPor: uuid('liberada_por'),
    bloqueadaEm: timestamp('bloqueada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ia_nutri_participacoes_paciente_unique').on(t.tenantId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_nutri_participacoes_paciente_fk' }),
    check('ia_nutri_participacoes_quem_liberou', sql`(${t.liberadaEm} is null) = (${t.liberadaPor} is null)`),
  ],
);

/**
 * Plano 15 (§13.1, RN-172, RN-178, RN-182, D21, D22, D32): a conversa. A pergunta (`paciente`) tem a situação; a resposta
 * (`ia`) tem o texto MONTADO pelo sistema (RN-172) ou o código de um texto fixo (`texto_fixo`, DP-4); a mensagem `sistema`
 * é o texto fixo do filtro de risco. `contou_no_limite` é o marcador não sensível dos limites (sobrevive à revogação, D32).
 * A FK de `responde_a` para a própria tabela (ON DELETE SET NULL (responde_a)) fica na 0116 (o Drizzle não escreve a lista
 * de colunas do SET NULL). Escritas: INSERT do paciente só por app_ia_nutri_perguntar (0117); UPDATE do paciente só de
 * `avaliacao` e `encaminhada_em` (gatilho ia_nutri_mensagens_regras, 0116); DELETE pelo gatilho ia_nutri_mensagens_sem_apagar.
 */
export const iaNutriMensagens = pgTable(
  'ia_nutri_mensagens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    /** RN-173: a primeira mensagem da sessão (30 min sem mensagem abre outra). */
    sessaoInicio: timestamp('sessao_inicio', { withTimezone: true }).notNull(),
    autor: text('autor').notNull(),
    /** O que o paciente escreveu, ou a resposta montada (RN-172). Nulo depois da retenção ou da revogação. */
    texto: text('texto'),
    /** DP-4: código do texto fixo (TEXTOS_FIXOS) nas mensagens `ia` e `sistema` que o mostram. */
    textoFixo: text('texto_fixo'),
    tipoResposta: text('tipo_resposta'),
    respondeA: uuid('responde_a'),
    /** Só na pergunta (autor `paciente`). */
    status: text('status'),
    categoria: text('categoria'),
    /** Os índices citados (sem texto), ex.: ["#S2"]. */
    fontes: jsonb('fontes').$type<string[]>(),
    motivoTecnico: text('motivo_tecnico'),
    risco: text('risco'),
    encaminhadaEm: timestamp('encaminhada_em', { withTimezone: true }),
    /** D22: quando a nutricionista abriu a dúvida (a pergunta com risco de quem revogou é apagada ao abrir). */
    abertaPelaNutriEm: timestamp('aberta_pela_nutri_em', { withTimezone: true }),
    resolvidaEm: timestamp('resolvida_em', { withTimezone: true }),
    resolvidaPor: uuid('resolvida_por'),
    resolucao: text('resolucao'),
    avaliacao: text('avaliacao'),
    modelo: text('modelo'),
    promptVersao: text('prompt_versao'),
    reservaMicroUsd: bigint('reserva_micro_usd', { mode: 'number' }).notNull().default(0),
    /** Portão do envio (RN-109, D4 do Plano 11): marca de "pode ter sido processado"; volta a nulo só antes de repetir. */
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    /** Primeira saída ao provedor e o destino: nunca mudam nem voltam a nulo (gatilho). */
    saiuEm: timestamp('saiu_em', { withTimezone: true }),
    destino: text('destino'),
    revogadaEm: timestamp('revogada_em', { withTimezone: true }),
    contouNoLimite: boolean('contou_no_limite').notNull().default(false),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ia_nutri_mensagens_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_nutri_mensagens_paciente_fk' }),
    check('ia_nutri_mensagens_autor_valido', sql`${t.autor} in ('paciente', 'ia', 'sistema')`),
    check(
      'ia_nutri_mensagens_texto_tamanho',
      sql`${t.texto} is null or (${t.autor} = 'paciente' and char_length(${t.texto}) between 1 and 500) or (${t.autor} = 'ia' and char_length(${t.texto}) between 1 and 24000)`,
    ),
    check(
      'ia_nutri_mensagens_texto_fixo_valido',
      sql`${t.textoFixo} is null or (${t.autor} <> 'paciente' and ${t.textoFixo} in ('risco_emergencia', 'risco_transtorno', 'sintoma_agudo', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'nao_encontrei', 'falha', 'indisponivel'))`,
    ),
    check('ia_nutri_mensagens_status', sql`(${t.autor} = 'paciente') = (${t.status} is not null) and (${t.status} is null or ${t.status} in ('na_fila', 'processando', 'respondida', 'falhou', 'cancelada'))`),
    check('ia_nutri_mensagens_responde_a', sql`${t.respondeA} is null or ${t.autor} <> 'paciente'`),
    check(
      'ia_nutri_mensagens_categoria_valida',
      sql`${t.categoria} is null or ${t.categoria} in ('plano', 'fora_do_escopo', 'mudanca_plano', 'sintoma_ou_exame', 'suplemento_ou_remedio', 'peso_ou_dieta_restritiva', 'risco')`,
    ),
    check('ia_nutri_mensagens_tipo_resposta_valido', sql`${t.tipoResposta} is null or (${t.autor} = 'ia' and ${t.tipoResposta} in ('quantidade', 'substituicao', 'horario', 'refeicao', 'orientacao'))`),
    check('ia_nutri_mensagens_risco_valido', sql`${t.risco} is null or (${t.autor} = 'paciente' and ${t.risco} in ('emergencia', 'transtorno_alimentar', 'modelo'))`),
    check(
      'ia_nutri_mensagens_motivo_valido',
      sql`${t.motivoTecnico} is null or ${t.motivoTecnico} in ('invalida_fonte', 'invalida_tipo', 'invalida_termo', 'invalida_formato', 'recusa', 'interrompida', 'cota', 'teto_plataforma', 'provedor_indisponivel', 'resultado_incerto', 'limite_custo', 'indisponivel', 'condicao')`,
    ),
    check('ia_nutri_mensagens_so_da_pergunta', sql`${t.autor} = 'paciente' or (${t.encaminhadaEm} is null and ${t.abertaPelaNutriEm} is null and ${t.resolvidaEm} is null and ${t.saiuEm} is null and ${t.enviadoEm} is null)`),
    check('ia_nutri_mensagens_avaliacao_valida', sql`${t.avaliacao} is null or (${t.autor} = 'ia' and ${t.avaliacao} in ('ajudou', 'nao_ajudou'))`),
    check('ia_nutri_mensagens_resolucao', sql`(${t.resolucao} is null) = (${t.resolvidaEm} is null) and (${t.resolucao} is null or ${t.resolucao} in ('vista', 'encerrada'))`),
    check('ia_nutri_mensagens_destino_valido', sql`${t.destino} is null or (${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste') and ${t.saiuEm} is not null)`),
    check('ia_nutri_mensagens_reserva_valida', sql`${t.reservaMicroUsd} >= 0`),
    check('ia_nutri_mensagens_textos_tecnicos', sql`(${t.modelo} is null or char_length(${t.modelo}) <= 60) and (${t.promptVersao} is null or char_length(${t.promptVersao}) <= 60)`),
    index('ia_nutri_mensagens_fila_idx').on(t.tenantId, t.encaminhadaEm).where(sql`${t.encaminhadaEm} is not null and ${t.resolvidaEm} is null`),
    index('ia_nutri_mensagens_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
    index('ia_nutri_mensagens_limites_idx').on(t.tenantId, t.patientId, t.createdAt).where(sql`${t.contouNoLimite}`),
    index('ia_nutri_mensagens_expira_idx').on(t.tenantId, t.expiraEm),
    // RN-178: uma pergunta por vez (5 chamadas simultâneas: 1 ok, 4 em_andamento — a trava do paciente serializa; o índice é a rede)
    uniqueIndex('ia_nutri_mensagens_uma_por_vez').on(t.tenantId, t.patientId).where(sql`${t.status} in ('na_fila', 'processando')`),
  ],
);
export type IaNutriMensagemRow = typeof iaNutriMensagens.$inferSelect;

/**
 * Plano 15 (RN-171, D26; molde de ia_autorizacoes, 0108): a prova do consentimento da IA Nutri, só de inclusão. O estado é o
 * último evento. `registrado_em` vem do gatilho (clock_timestamp, depois da trava do paciente). Sem gatilho de auditoria
 * (AUDIT_EXCEPTIONS): a própria linha é a prova. A anonimização só por app_anonimizar_consentimentos_ia_nutri (0117).
 */
export const iaNutriConsentimentos = pgTable(
  'ia_nutri_consentimentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    evento: text('evento').notNull(),
    versao: text('versao'),
    destino: text('destino'),
    canal: text('canal').notNull().default('app'),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
    registradoPor: uuid('registrado_por'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_nutri_consentimentos_paciente_fk' }),
    check('ia_nutri_consentimentos_evento_valido', sql`${t.evento} in ('aceite', 'revogacao')`),
    check('ia_nutri_consentimentos_versao', sql`(${t.evento} = 'aceite') = (${t.versao} is not null) and (${t.versao} is null or char_length(${t.versao}) between 1 and 40)`),
    check('ia_nutri_consentimentos_destino', sql`(${t.evento} = 'aceite') = (${t.destino} is not null) and (${t.destino} is null or ${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste'))`),
    // DP-17: a revogação também pela nutricionista, a pedido do paciente (o aceite é só no app)
    check('ia_nutri_consentimentos_canal_valido', sql`${t.canal} in ('app', 'nutricionista') and (${t.canal} = 'app' or ${t.evento} = 'revogacao')`),
    check('ia_nutri_consentimentos_tamanhos', sql`(${t.ip} is null or char_length(${t.ip}) <= 45) and (${t.userAgent} is null or char_length(${t.userAgent}) <= 300)`),
    index('ia_nutri_consentimentos_paciente_idx').on(t.tenantId, t.patientId, t.registradoEm),
  ],
);
export type IaNutriConsentimentoRow = typeof iaNutriConsentimentos.$inferSelect;

/**
 * Plano 15 (RN-185, §13.2, DP-1): a pausa da IA Nutri em TODOS os consultórios — uma linha só, sem tenant_id, fora da RLS
 * (como ia_gasto_plataforma). Gravada só pelo painel do admin (fora de withTenant): o gatilho ia_nutri_pausa_da_admin
 * recusa escrita com app.role preenchido (0116). Nasce NÃO pausada: é só o desligamento de emergência (DP-1, ★ DO-1 = não).
 */
export const iaNutriPausa = pgTable(
  'ia_nutri_pausa',
  {
    id: boolean('id').primaryKey().default(true),
    pausadaEm: timestamp('pausada_em', { withTimezone: true }),
    /** O admin que pausou (nulo na criação pela migration). Sem FK. */
    pausadaPor: uuid('pausada_por'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ia_nutri_pausa_linha_unica', sql`${t.id}`)],
);
