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
    /** Plano 23 (§9.3): o local da regra. Anulável só porque a imagem anterior ao PR 2 ainda grava sem ele (RN-410a). */
    localId: uuid('local_id'),
  },
  (t) => [
    check('availability_rules_dia_valido', sql`${t.diaSemana} between 0 and 6`),
    check('availability_rules_fim_depois', sql`${t.fim} > ${t.inicio}`),
    check('availability_rules_duracao_faixa', sql`${t.duracaoMin} between 15 and 240`),
    check('availability_rules_modalidade_valida', sql`${t.modalidade} in ('presencial', 'online', 'ambas')`),
    index('availability_rules_dia_idx').on(t.tenantId, t.diaSemana),
    // Plano 23: a regra com local tem uma modalidade só (o "ambas" é desdobrado no backfill, AG-D47)
    check('availability_rules_local_sem_ambas', sql`${t.localId} is null or ${t.modalidade} <> 'ambas'`),
    foreignKey({
      columns: [t.tenantId, t.localId, t.modalidade],
      foreignColumns: [locaisAtendimento.tenantId, locaisAtendimento.id, locaisAtendimento.tipo],
      name: 'availability_rules_local_fk',
    }),
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
    /** Plano 23 (§9.2): o local da consulta; nulo nas consultas antigas (sem backfill, AG-D5) e nas da imagem anterior ao PR 2. */
    localId: uuid('local_id'),
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
    // Plano 23 (RN-421): `solicitada` = pedido do paciente à espera da nutricionista
    check('appointments_status_valido', sql`${t.status} in ('agendada', 'confirmada', 'cancelada', 'realizada', 'faltou', 'solicitada')`),
    check('appointments_solicitada_do_paciente', sql`${t.status} <> 'solicitada' or ${t.origem} = 'paciente'`),
    check('appointments_origem_valida', sql`${t.origem} in ('nutri', 'paciente')`),
    check('appointments_confirmada_via_valida', sql`${t.confirmadaVia} is null or ${t.confirmadaVia} in ('whatsapp', 'link')`),
    // migration 0067 (fechamento): 'sistema' = cancelada sozinha ao atender o pedido de exclusão (US-018), sem aviso ao paciente
    // Plano 23 (AG-D44): os três motivos do pedido só valem saindo de `solicitada` (gatilho appointments_regras_pedido)
    check(
      'appointments_cancelado_por_valido',
      sql`${t.canceladoPor} is null or ${t.canceladoPor} in ('nutri', 'paciente', 'sistema', 'pedido_desistido', 'pedido_recusado', 'pedido_vencido')`,
    ),
    check('appointments_cancelamento_completo', sql`(${t.status} = 'cancelada') = (${t.canceladoPor} is not null and ${t.canceladaEm} is not null)`),
    check('appointments_motivo_tamanho', sql`char_length(${t.motivoCancelamento}) <= 300`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'appointments_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.remarcadaDe], foreignColumns: [t.tenantId, t.id], name: 'appointments_remarcada_de_fk' }),
    unique('appointments_tenant_id_unique').on(t.tenantId, t.id),
    unique('appointments_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    index('appointments_inicio_idx').on(t.tenantId, t.inicio),
    index('appointments_paciente_idx').on(t.tenantId, t.patientId, t.inicio),
    // Plano 23 (§9.2): MATCH SIMPLE — consulta sem local não é conferida; NO ACTION: local usado não muda de tipo nem sai
    foreignKey({
      columns: [t.tenantId, t.localId, t.modalidade],
      foreignColumns: [locaisAtendimento.tenantId, locaisAtendimento.id, locaisAtendimento.tipo],
      name: 'appointments_local_fk',
    }),
    index('appointments_local_idx').on(t.tenantId, t.localId, t.inicio),
  ],
);

/** Plano 23 (AG-D44): `cancelado_por` dos pedidos que não viraram consulta; só valem saindo de `solicitada` (RN-422). */
export const CANCELADO_POR_PEDIDO = ['pedido_desistido', 'pedido_recusado', 'pedido_vencido'] as const;

export type AppointmentRow = typeof appointments.$inferSelect;

/**
 * D6: tipos com no máximo uma linha por (consulta, canal, tipo, início da consulta) — os lembretes. Os avisos de evento
 * ("Consulta marcada", "Consulta cancelada") ficam fora: cada mudança do início gera um aviso novo (complemento da
 * Tarefa 5). As respostas "1"/"2" (Tarefa 12) também saíram (code-review do PR #7, migration 0068): o teto delas
 * (1 WhatsApp de cada tipo por horário; e-mail com o link de novo só num pedido novo, a cada 60 min) é conferido sob a
 * trava da consulta no webhook (`respostasDevidas`, src/modules/notificacoes/whatsapp/webhook.ts). Lista única: o
 * índice parcial (schema → migration gerada) e o `ON CONFLICT` de `gravar` (src/modules/notificacoes/agendar.ts) usam
 * `tipoUmPorHorario`.
 */
export const TIPOS_UM_POR_HORARIO = ['lembrete_24h', 'lembrete_2h'] as const;

/** Predicado do índice parcial, com literais: o `ON CONFLICT … WHERE` só encontra o índice se o predicado for o mesmo (sem parâmetros). */
export const tipoUmPorHorario = (tipo: PgColumn): SQL => sql`${tipo} in (${sql.raw(TIPOS_UM_POR_HORARIO.map((t) => `'${t}'`).join(', '))})`;

/**
 * Plano 23 (RN-432, §9.8): expressão e predicado do índice único `notifications_aniversario_unique` — uma mensagem de
 * aniversário por paciente e ano (UTC). O `ON CONFLICT` do agendamento repete os dois, com literais, para achar o índice.
 * `timezone(text, timestamptz)` e `date_part` sobre `timestamp` sem fuso são IMMUTABLE (sem coluna gerada).
 */
export const ANIVERSARIO_UM_POR_ANO = {
  ano: (agendadaPara: PgColumn): SQL => sql`(date_part('year', timezone('UTC', ${agendadaPara})))`,
  onde: (tipo: PgColumn): SQL => sql`${tipo} = 'aniversario'`,
};

/**
 * RN-05 / D6: lembretes têm uma linha por (consulta, canal, tipo, início da consulta) — índice único parcial
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
    check('notifications_tipo_valido', sql`${t.tipo} in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo', 'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado', 'duvida_vista', 'aniversario', 'pedido_nao_confirmado')`),
    check('notifications_status_valido', sql`${t.status} in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'ignorada')`),
    check('notifications_motivo_so_ignorada', sql`(${t.status} = 'ignorada') = (${t.motivoIgnorada} is not null)`),
    check('notifications_erro_tamanho', sql`char_length(${t.erro}) <= 60`),
    check('notifications_versao_da_consulta', sql`(${t.appointmentId} is null) = (${t.inicioConsulta} is null)`),
    // T14 (revisão da T11): o texto cifrado (convite com link de uso único) só existe até o envio — toda saída final o apaga
    check('notifications_conteudo_so_antes_do_envio', sql`${t.conteudoSelado} is null or ${t.status} in ('pendente', 'enviando')`),
    // US-053 / D5: "no máximo 1 push de conteúdo por paciente a cada 24 h" — o último aviso do paciente
    index('notifications_conteudo_idx').on(t.tenantId, t.patientId, t.createdAt).where(sql`${t.tipo} = 'conteudo_novo'`),
    uniqueIndex('notifications_versao_unique').on(t.appointmentId, t.canal, t.tipo, t.inicioConsulta).where(tipoUmPorHorario(t.tipo)),
    // Plano 23 (RN-432): uma mensagem de aniversário por paciente e ano (UTC), inclusive a ignorada
    uniqueIndex('notifications_aniversario_unique')
      .on(t.tenantId, t.patientId, ANIVERSARIO_UM_POR_ANO.ano(t.agendadaPara))
      .where(ANIVERSARIO_UM_POR_ANO.onde(t.tipo)),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'notifications_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.patientId, appointments.id], name: 'notifications_consulta_fk' }),
    index('notifications_devidas_idx').on(t.tenantId, t.status, t.agendadaPara),
    index('notifications_envios_idx').on(t.tenantId, t.canal, t.enviadaEm),
    // respostas "1"/"2" (`responder` em whatsapp/webhook.ts): as respostas já gravadas de uma consulta naquele horário
    index('notifications_consulta_inicio_idx').on(t.appointmentId, t.inicioConsulta),
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
    /** Plano 23 (§9.4, RN-424): o pedido da pessoa nova aguardando a nutricionista — fim, local e desde quando. */
    fim: timestamp('fim', { withTimezone: true }),
    localId: uuid('local_id'),
    aguardandoDesde: timestamp('aguardando_desde', { withTimezone: true }),
    /** AG-D63: quando e como o aguardando terminou (RESOLUCOES_DO_PEDIDO), gravados juntos. */
    resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
    resolucao: text('resolucao'),
  },
  (t) => [
    check('public_booking_requests_modalidade', sql`${t.modalidade} in ('presencial', 'online')`),
    check('public_booking_requests_nome', sql`char_length(${t.nome}) between 2 and 120`),
    // migration 0066 (revisão final): a consulta criada pelo pedido, do mesmo consultório (NO ACTION: consulta não é apagada)
    foreignKey({ columns: [t.tenantId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.id], name: 'public_booking_requests_consulta_fk' }),
    index('public_booking_requests_email_idx').on(t.tenantId, t.email, t.createdAt),
    index('public_booking_requests_criado_idx').on(t.tenantId, t.createdAt),
    // Plano 23 (§9.4): o aguardando só existe depois do código, com o horário inteiro e o local
    check(
      'public_booking_requests_aguardando_completo',
      sql`${t.aguardandoDesde} is null or (${t.verificadoEm} is not null and ${t.fim} is not null and ${t.localId} is not null)`,
    ),
    check('public_booking_requests_resolvido_so_aguardando', sql`${t.resolvidoEm} is null or ${t.aguardandoDesde} is not null`),
    check('public_booking_requests_resolucao', sql`(${t.resolucao} is null) = (${t.resolvidoEm} is null)`),
    check('public_booking_requests_resolucao_valida', sql`${t.resolucao} is null or ${t.resolucao} in ('aceito', 'recusado', 'vencido', 'desistido')`),
    foreignKey({
      columns: [t.tenantId, t.localId, t.modalidade],
      foreignColumns: [locaisAtendimento.tenantId, locaisAtendimento.id, locaisAtendimento.tipo],
      name: 'public_booking_requests_local_fk',
    }),
    index('public_booking_requests_aguardando_idx').on(t.tenantId, t.inicio).where(sql`${t.aguardandoDesde} is not null and ${t.resolvidoEm} is null`),
    // RN-425: um pedido aguardando por e-mail no consultório (rede do teto conferido por app_pedido_aguardar)
    uniqueIndex('public_booking_requests_aguardando_email_unique')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.aguardandoDesde} is not null and ${t.resolvidoEm} is null`),
  ],
);

/** Plano 23 (AG-D63): como terminou o pedido aguardando da pessoa nova; gravada junto com `resolvido_em`. */
export const RESOLUCOES_DO_PEDIDO = ['aceito', 'recusado', 'vencido', 'desistido'] as const;

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
    // Review Focus 4: um endpoint pertence a uma conta só — app_soltar_endpoint_push procura o endpoint em cada tenant
    index('push_subscriptions_endpoint_idx').on(t.endpoint),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** Plano 23 (US-400): tipo do local de atendimento; é o alvo da FK composta com a `modalidade` da consulta, da regra e do pedido. */
export const TIPOS_DE_LOCAL = ['presencial', 'online'] as const;
export type TipoDeLocal = (typeof TIPOS_DE_LOCAL)[number];

/**
 * Plano 23 (§9.1, US-400): locais de atendimento do consultório. Sem `patient_id`; staff_only (o `link_sala` nunca chega
 * ao paciente nem ao público): o portal e a página pública leem só pelas projeções `app_locais_para_agendamento` e
 * `app_local_da_consulta` (AG-D4). Arquiva-se, não se apaga quando usado (FKs NO ACTION de consultas, regras e pedidos).
 */
export const locaisAtendimento = pgTable(
  'locais_atendimento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    tipo: text('tipo').notNull(),
    endereco: text('endereco'),
    cidade: text('cidade'),
    /** Mostra o endereço na página pública e na escolha do portal. */
    mostrarEndereco: boolean('mostrar_endereco').notNull().default(false),
    /** Sala fixa do local online; copiada para `appointments.link_online` pelo gatilho appointments_link_da_sala. */
    linkSala: text('link_sala'),
    /** Aceita agendamento pelo paciente (portal e, com a página ligada, a pública). */
    agendamentoOnline: boolean('agendamento_online').notNull().default(false),
    principal: boolean('principal').notNull().default(false),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('locais_atendimento_nome_tamanho', sql`char_length(${t.nome}) between 2 and 60`),
    check('locais_atendimento_tipo_valido', sql`${t.tipo} in ('presencial', 'online')`),
    check('locais_atendimento_endereco', sql`${t.endereco} is null or (${t.tipo} = 'presencial' and char_length(${t.endereco}) <= 300)`),
    check('locais_atendimento_cidade_tamanho', sql`${t.cidade} is null or char_length(${t.cidade}) <= 80`),
    // como appointments_link_online (0066): `\S+` e o teto de 500
    check(
      'locais_atendimento_link_sala',
      sql`${t.linkSala} is null or (${t.tipo} = 'online' and ${t.linkSala} ~ '^https://\\S+$' and char_length(${t.linkSala}) <= 500)`,
    ),
    check(
      'locais_atendimento_agendamento',
      sql`not ${t.agendamentoOnline} or (${t.arquivadoEm} is null and (${t.tipo} = 'presencial' or ${t.linkSala} is not null))`,
    ),
    check('locais_atendimento_principal_ativo', sql`not ${t.principal} or ${t.arquivadoEm} is null`),
    uniqueIndex('locais_atendimento_principal_unique').on(t.tenantId).where(sql`${t.principal} and ${t.arquivadoEm} is null`),
    uniqueIndex('locais_atendimento_nome_unique').on(t.tenantId, sql`lower(${t.nome})`).where(sql`${t.arquivadoEm} is null`),
    // alvo das FKs compostas (tenant, local, modalidade) de appointments, availability_rules e public_booking_requests
    unique('locais_atendimento_tenant_id_tipo_unique').on(t.tenantId, t.id, t.tipo),
  ],
);

export type LocalRow = typeof locaisAtendimento.$inferSelect;

/** Plano 23 (RN-433): eventos, origens e formas da autorização de mensagens de aniversário. */
export const EVENTOS_ANIVERSARIO = ['autorizou', 'retirou'] as const;
export const ORIGENS_ANIVERSARIO = ['nutri', 'app', 'link'] as const;
export const FORMAS_ANIVERSARIO = ['escrito', 'mensagem', 'verbal'] as const;
export type FormaAniversario = (typeof FORMAS_ANIVERSARIO)[number];

/**
 * Plano 23 (§9.7, RN-433): autorização do paciente para receber mensagem de aniversário — prova só de inclusão (UPDATE,
 * DELETE e TRUNCATE revogados), estado = último evento. `registrado_em` pelo relógio do banco (gatilho
 * aniversario_autorizacoes_regras); `registrado_por` sem FK (como `criado_por` do Plano 20): a nutricionista ou a conta
 * do paciente, nulo no link. Fora da auditoria (AUDIT_EXCEPTIONS): quem, quando, origem e forma estão na própria linha.
 */
export const aniversarioAutorizacoes = pgTable(
  'aniversario_autorizacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    evento: text('evento').notNull(),
    origem: text('origem').notNull(),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
    registradoPor: uuid('registrado_por'),
    /** Como o paciente autorizou (só origem `nutri`; ônus da prova, LGPD art. 8º, § 2º); opcional na retirada (§ 5º, AG-D61). */
    forma: text('forma'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'aniversario_autorizacoes_paciente_fk' }),
    check('aniversario_autorizacoes_evento_valido', sql`${t.evento} in ('autorizou', 'retirou')`),
    check('aniversario_autorizacoes_origem_valida', sql`${t.origem} in ('nutri', 'app', 'link')`),
    check('aniversario_autorizacoes_forma_valida', sql`${t.forma} is null or ${t.forma} in ('escrito', 'mensagem', 'verbal')`),
    check(
      'aniversario_autorizacoes_forma',
      sql`(${t.origem} = 'nutri' and (${t.evento} = 'retirou' or ${t.forma} is not null)) or (${t.origem} <> 'nutri' and ${t.forma} is null)`,
    ),
    // RN-433: o link de saída nunca dá consentimento e não tem conta (a política paciente_aniversario_proprio repete na sessão de paciente)
    check('aniversario_autorizacoes_link', sql`${t.origem} <> 'link' or (${t.evento} = 'retirou' and ${t.registradoPor} is null)`),
    index('aniversario_autorizacoes_paciente_idx').on(t.tenantId, t.patientId, t.registradoEm.desc()),
  ],
);

export type AniversarioAutorizacaoRow = typeof aniversarioAutorizacoes.$inferSelect;
