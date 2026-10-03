import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, pgTable, smallint, text, time, timestamp, unique, uniqueIndex, uuid, type PgColumn } from 'drizzle-orm/pg-core';
import { citext, patients } from './pacientes';
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

/**
 * US-031 a US-037. D9: `inicio`/`fim` + EXCLUDE (migration custom) contra sobreposição de consultas não
 * canceladas do tenant; `realizada`/`faltou` continuam ocupando o horário. D17: `remarcada_de` liga a
 * consulta nova à cancelada quando o paciente remarca.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    modalidade: text('modalidade').notNull(),
    linkOnline: text('link_online'),
    status: text('status').notNull().default('agendada'),
    origem: text('origem').notNull(),
    confirmadaVia: text('confirmada_via'),
    canceladoPor: text('cancelado_por'),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),
    pedidoRemarcacaoEm: timestamp('pedido_remarcacao_em', { withTimezone: true }),
    remarcadaDe: uuid('remarcada_de'),
    presencaEm: timestamp('presenca_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('appointments_periodo_valido', sql`${t.fim} > ${t.inicio} and ${t.fim} - ${t.inicio} <= interval '8 hours'`),
    check('appointments_modalidade_valida', sql`${t.modalidade} in ('presencial', 'online')`),
    // migration 0066 (revisão final): `is not null` explícito — sem ele, online com link nulo dava NULL (lógica de 3 valores)
    // e o CHECK deixava passar; `\S+` como o `linkValido` da aplicação (consultas.ts)
    check(
      'appointments_link_online',
      sql`(${t.modalidade} = 'presencial' and ${t.linkOnline} is null) or (${t.modalidade} = 'online' and ${t.linkOnline} is not null and ${t.linkOnline} ~ '^https://\\S+$' and char_length(${t.linkOnline}) <= 500)`,
    ),
    check('appointments_status_valido', sql`${t.status} in ('agendada', 'confirmada', 'cancelada', 'realizada', 'faltou')`),
    check('appointments_origem_valida', sql`${t.origem} in ('nutri', 'paciente')`),
    check('appointments_confirmada_via_valida', sql`${t.confirmadaVia} is null or ${t.confirmadaVia} in ('whatsapp', 'link')`),
    // migration 0067 (fechamento): 'sistema' = cancelada sozinha ao atender o pedido de exclusão (US-018), sem aviso ao paciente
    check('appointments_cancelado_por_valido', sql`${t.canceladoPor} is null or ${t.canceladoPor} in ('nutri', 'paciente', 'sistema')`),
    check('appointments_cancelamento_completo', sql`(${t.status} = 'cancelada') = (${t.canceladoPor} is not null and ${t.canceladaEm} is not null)`),
    check('appointments_motivo_tamanho', sql`char_length(${t.motivoCancelamento}) <= 300`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'appointments_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.remarcadaDe], foreignColumns: [t.tenantId, t.id], name: 'appointments_remarcada_de_fk' }),
    unique('appointments_tenant_id_unique').on(t.tenantId, t.id),
    unique('appointments_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    index('appointments_inicio_idx').on(t.tenantId, t.inicio),
    index('appointments_paciente_idx').on(t.tenantId, t.patientId, t.inicio),
  ],
);

export type AppointmentRow = typeof appointments.$inferSelect;

/**
 * D6: tipos com no máximo uma linha por (consulta, canal, tipo, início da consulta) — os lembretes e as respostas
 * "1"/"2" (Tarefa 12). Os avisos de evento ("Consulta marcada", "Consulta cancelada") ficam fora: cada mudança do início
 * gera um aviso novo (complemento da Tarefa 5). Lista única: o índice parcial (schema → migration gerada) e o
 * `ON CONFLICT` de `gravar` (src/modules/notificacoes/agendar.ts) usam `tipoUmPorHorario`.
 */
export const TIPOS_UM_POR_HORARIO = ['lembrete_24h', 'lembrete_2h', 'resposta_confirmacao', 'resposta_remarcar'] as const;

/** Predicado do índice parcial, com literais: o `ON CONFLICT … WHERE` só encontra o índice se o predicado for o mesmo (sem parâmetros). */
export const tipoUmPorHorario = (tipo: PgColumn): SQL => sql`${tipo} in (${sql.raw(TIPOS_UM_POR_HORARIO.map((t) => `'${t}'`).join(', '))})`;

/**
 * RN-05 / D6: lembretes e respostas têm uma linha por (consulta, canal, tipo, início da consulta) — índice único parcial
 * `notifications_versao_unique`. Marcar de novo no mesmo horário ou reativar reescreve só a linha que não saiu; mudar o
 * horário cria linhas novas — a enviada é imutável (cota, métricas, histórico). Avisos de evento: uma linha por evento.
 * As condições de cada canal (opt-in, cota, inscrição…) são conferidas no envio. Registro técnico: sem auditoria (D10).
 * `provider_jid`: destino real no WhatsApp (casa a resposta "1"/"2"); `conteudo_selado`: convite com link cifrado até o envio;
 * `inicio_consulta`: o horário da consulta para o qual a linha foi planejada (nulo só sem consulta: convite).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    appointmentId: uuid('appointment_id'),
    canal: text('canal').notNull(),
    tipo: text('tipo').notNull(),
    status: text('status').notNull().default('pendente'),
    motivoIgnorada: text('motivo_ignorada'),
    erro: text('erro'),
    providerMsgId: text('provider_msg_id').unique(),
    providerJid: text('provider_jid'),
    conteudoSelado: text('conteudo_selado'),
    tentativas: smallint('tentativas').notNull().default(0),
    inicioConsulta: timestamp('inicio_consulta', { withTimezone: true }),
    agendadaPara: timestamp('agendada_para', { withTimezone: true }).notNull(),
    enviadaEm: timestamp('enviada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('notifications_canal_valido', sql`${t.canal} in ('email', 'whatsapp', 'push')`),
    check('notifications_tipo_valido', sql`${t.tipo} in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar')`),
    check('notifications_status_valido', sql`${t.status} in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'ignorada')`),
    check('notifications_motivo_so_ignorada', sql`(${t.status} = 'ignorada') = (${t.motivoIgnorada} is not null)`),
    check('notifications_erro_tamanho', sql`char_length(${t.erro}) <= 60`),
    check('notifications_versao_da_consulta', sql`(${t.appointmentId} is null) = (${t.inicioConsulta} is null)`),
    // T14 (revisão da T11): o texto cifrado (convite com link de uso único) só existe até o envio — toda saída final o apaga
    check('notifications_conteudo_so_antes_do_envio', sql`${t.conteudoSelado} is null or ${t.status} in ('pendente', 'enviando')`),
    uniqueIndex('notifications_versao_unique').on(t.appointmentId, t.canal, t.tipo, t.inicioConsulta).where(tipoUmPorHorario(t.tipo)),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'notifications_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.patientId, appointments.id], name: 'notifications_consulta_fk' }),
    index('notifications_devidas_idx').on(t.tenantId, t.status, t.agendadaPara),
    index('notifications_envios_idx').on(t.tenantId, t.canal, t.enviadaEm),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * RN-16 / D12: pedido da página pública até o código de 6 dígitos ser confirmado. Só o hash do token do pedido e o
 * HMAC do código são guardados; a linha some em 24 h (agenda-limpeza). A sessão de paciente não vê (staff_only); o
 * contexto `publico` lê, cria e atualiza (D11).
 */
export const publicBookingRequests = pgTable(
  'public_booking_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tokenHash: text('token_hash').notNull().unique(),
    codigoHash: text('codigo_hash').notNull(),
    email: citext('email').notNull(),
    nome: text('nome').notNull(),
    telefoneE164: text('telefone_e164'),
    whatsappOptin: boolean('whatsapp_optin').notNull().default(false),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    modalidade: text('modalidade').notNull(),
    termoVersao: text('termo_versao').notNull(),
    ip: text('ip'),
    tentativas: smallint('tentativas').notNull().default(0),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    verificadoEm: timestamp('verificado_em', { withTimezone: true }),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    appointmentId: uuid('appointment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('public_booking_requests_modalidade', sql`${t.modalidade} in ('presencial', 'online')`),
    check('public_booking_requests_nome', sql`char_length(${t.nome}) between 2 and 120`),
    // migration 0066 (revisão final): a consulta criada pelo pedido, do mesmo consultório (NO ACTION: consulta não é apagada)
    foreignKey({ columns: [t.tenantId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.id], name: 'public_booking_requests_consulta_fk' }),
    index('public_booking_requests_email_idx').on(t.tenantId, t.email, t.createdAt),
    index('public_booking_requests_criado_idx').on(t.tenantId, t.createdAt),
  ],
);

/**
 * RN-16: contadores da página pública e marcas anti-repetição do webhook do WhatsApp (D4 b). A chave é o HMAC do IP, do
 * e-mail ou do pedido do webhook, nunca o valor. Sem tenant_id: só limite-ip.ts.
 */
export const publicRateLimits = pgTable('public_rate_limits', {
  chave: text('chave').primaryKey(),
  janelaInicio: timestamp('janela_inicio', { withTimezone: true }).notNull(),
  contagem: integer('contagem').notNull(),
});

/**
 * D2: uma instância da Evolution por tenant (`nd-<tenantId>`). Estado vindo do webhook (connection.update) e da
 * consulta do painel. `aviso_desconexao_em`: o último e-mail de desconexão (no máximo um a cada 6 h); `aviso_cota_mes`: 'AAAA-MM' do aviso de 80% (Tarefa 11).
 */
export const whatsappConexoes = pgTable(
  'whatsapp_conexoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id),
    instancia: text('instancia').notNull().unique(),
    estado: text('estado').notNull().default('desconectada'),
    numeroE164: text('numero_e164'),
    conectadaEm: timestamp('conectada_em', { withTimezone: true }),
    desconectadaEm: timestamp('desconectada_em', { withTimezone: true }),
    avisoDesconexaoEm: timestamp('aviso_desconexao_em', { withTimezone: true }),
    avisoCotaMes: text('aviso_cota_mes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('whatsapp_conexoes_estado_valido', sql`${t.estado} in ('conectada', 'conectando', 'desconectada')`),
    check('whatsapp_conexoes_instancia_do_tenant', sql`${t.instancia} = 'nd-' || ${t.tenantId}::text`),
    check('whatsapp_conexoes_numero_e164', sql`${t.numeroE164} is null or ${t.numeroE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export type WhatsappConexaoRow = typeof whatsappConexoes.$inferSelect;

/**
 * INT-03 / D14: inscrição de push por vínculo e dispositivo. Gravada pelo P06-02 (sessão do paciente); o worker
 * envia e apaga as que o serviço de push devolve 404/410. Apagada na exclusão LGPD (US-018). Endereço técnico do
 * dispositivo, sem dado clínico: fora da auditoria (AUDIT_EXCEPTIONS).
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('push_subscriptions_vinculo_endpoint_unique').on(t.tenantId, t.patientId, t.endpoint),
    check('push_subscriptions_endpoint_https', sql`${t.endpoint} ~ '^https://' and char_length(${t.endpoint}) <= 1000`),
    check('push_subscriptions_chaves', sql`${t.p256dh} ~ '^[A-Za-z0-9_-]{80,100}$' and ${t.auth} ~ '^[A-Za-z0-9_-]{16,30}$'`),
    check('push_subscriptions_user_agent', sql`char_length(${t.userAgent}) <= 300`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'push_subscriptions_paciente_fk' }),
    // sem índice próprio por (tenant_id, patient_id): é o prefixo do índice do UNIQUE acima
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
