import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nomeExibicao: text('nome_exibicao').notNull(),
    status: text('status').notNull().default('ativa'),
    fuso: text('fuso').notNull().default('America/Sao_Paulo'),
    crn: text('crn'),
    logoPath: text('logo_path'),
    corPrimaria: text('cor_primaria'),
    waCotaMensal: integer('wa_cota_mensal').notNull().default(500),
    antecedenciaMinH: integer('antecedencia_min_h').notNull().default(12),
    cancelamentoMinH: integer('cancelamento_min_h').notNull().default(24),
    enderecoConsultorio: text('endereco_consultorio'),
    linkOnlinePadrao: text('link_online_padrao'),
    // migration 0067 (decisão do dono, fechamento do Plano 05): a página pública nasce desligada; a nutricionista liga em Configurações
    agendamentoPublicoAtivo: boolean('agendamento_publico_ativo').notNull().default(false),
    mostrarPercGorduraPaciente: boolean('mostrar_perc_gordura_paciente').notNull().default(false),
    armazenamentoBytes: bigint('armazenamento_bytes', { mode: 'number' }).notNull().default(0),
    dpaAceitoEm: timestamp('dpa_aceito_em', { withTimezone: true }),
    dpaVersao: text('dpa_versao'),
    /** CS-03 / P-15 (D15): taxa de faltas (%) do mês anterior ao sistema, informada pelo admin (E-08). */
    taxaFaltasBase: numeric('taxa_faltas_base', { precision: 5, scale: 2, mode: 'number' }),
    /** CS-01 (D15): dia em que a nutricionista passou a atender pelo sistema. */
    goLiveEm: date('go_live_em', { mode: 'string' }),
    /** US-140 (Plano 10A): dados do carimbo dos documentos. */
    nomeProfissional: text('nome_profissional'),
    contatoEmail: text('contato_email'),
    contatoTelefoneE164: text('contato_telefone_e164'),
    /** D6 da spec: autodeclaração da habilitação em Fitoterapia (registro, data e versão do termo juntos ou nulos). */
    fitoterapiaRegistro: text('fitoterapia_registro'),
    fitoterapiaDeclaradaEm: timestamp('fitoterapia_declarada_em', { withTimezone: true }),
    fitoterapiaTermoVersao: text('fitoterapia_termo_versao'),
    /** D20 do Plano 10A: documentos só depois da liberação para uso real (CRN-3, termo, backup); o admin liga. */
    documentosLiberados: boolean('documentos_liberados').notNull().default(false),
    /** Plano 11 (A-06): liberação da IA para uso real — a admin liga só com ZDR, advogado, avaliação e textos finais. */
    iaLiberada: boolean('ia_liberada').notNull().default(false),
    /** US-101: a nutricionista ativou (aceite do aditivo, A-D20). Nulo = desativada. */
    iaAtivadaEm: timestamp('ia_ativada_em', { withTimezone: true }),
    iaAditivoVersao: text('ia_aditivo_versao'),
    /** A-D10 = (a): US$ por mês, padrão 15,00; ajustada pela admin (0–1000). */
    iaCotaMensalUsd: numeric('ia_cota_mensal_usd', { precision: 7, scale: 2, mode: 'number' }).notNull().default(15),
    /** US-102: AAAA-MM do último e-mail de 80% (um por mês). */
    iaAvisoMes: text('ia_aviso_mes'),
    /** Plano 12 (D18 = a): a nutricionista ligou o recebimento de exames pelo app. Nulo = desligado (nasce nulo para todos). */
    examesPacienteAtivadoEm: timestamp('exames_paciente_ativado_em', { withTimezone: true }),
    /** RN-168: último e-mail "exames novos" à nutricionista (no máximo 1 a cada 6 h). */
    examesAvisoEm: timestamp('exames_aviso_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_formato', sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check('tenants_status_valido', sql`${t.status} in ('ativa', 'suspensa')`),
    check('tenants_cor_formato', sql`${t.corPrimaria} is null or ${t.corPrimaria} ~ '^#[0-9a-fA-F]{6}$'`),
    check('tenants_antecedencia_faixa', sql`${t.antecedenciaMinH} between 0 and 72`),
    check('tenants_cancelamento_faixa', sql`${t.cancelamentoMinH} between 0 and 72`),
    check('tenants_wa_cota_valida', sql`${t.waCotaMensal} >= 0`),
    check('tenants_armazenamento_valido', sql`${t.armazenamentoBytes} >= 0`),
    check('tenants_taxa_faltas_base_valida', sql`${t.taxaFaltasBase} is null or ${t.taxaFaltasBase} between 0 and 100`),
    check('tenants_nome_profissional_tamanho', sql`${t.nomeProfissional} is null or char_length(${t.nomeProfissional}) between 5 and 120`),
    check('tenants_fitoterapia_junta', sql`(${t.fitoterapiaRegistro} is null) = (${t.fitoterapiaDeclaradaEm} is null) and (${t.fitoterapiaRegistro} is null) = (${t.fitoterapiaTermoVersao} is null)`),
    check('tenants_fitoterapia_tamanho', sql`${t.fitoterapiaRegistro} is null or char_length(${t.fitoterapiaRegistro}) between 1 and 60`),
    check('tenants_ia_cota_valida', sql`${t.iaCotaMensalUsd} between 0 and 1000`),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid('actor_user_id'),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: text('entidade_id'),
    /** Titular do dado (histórico por paciente, US-007). Nulo em ações que não são de um paciente. */
    patientId: uuid('patient_id'),
    ip: text('ip'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'audit_log_acao_valida',
      sql`${t.acao} in ('ler','criar','alterar','excluir','exportar','bloquear','anonimizar')`,
    ),
    index('audit_log_busca_idx').on(t.tenantId, t.entidade, t.entidadeId, t.criadoEm),
    index('audit_log_paciente_idx').on(t.tenantId, t.patientId, t.criadoEm),
  ],
);

export const systemHeartbeat = pgTable('system_heartbeat', {
  name: text('name').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
});

/** Arquivos em DATA_DIR (logo, capas, PDFs, exames, fotos) — base da cota de 5 GB (RN-18). */
export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tipo: text('tipo').notNull(),
    caminho: text('caminho').notNull().unique(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    criadoPor: uuid('criado_por'),
    /** P-16 (d) / D4: dono do arquivo (laudo, PDF do plano, foto do diário, exportação); nulo = arquivo do consultório (logo, capa). */
    patientId: uuid('patient_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'stored_files_tipo_valido',
      sql`${t.tipo} in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina','ia_autorizacao_termo')`,
    ),
    check('stored_files_bytes_positivo', sql`${t.bytes} > 0`),
    // logo/capa nunca têm dono; o resto sempre (orientacao_pdf é do Plano 07: do consultório).
    // A FK composta (tenant_id, patient_id) → patients fica na migration 0072 (este arquivo não importa patients: ciclo)
    check(
      'stored_files_dono',
      sql`(${t.tipo} in ('logo','capa','orientacao_pdf')) = (${t.patientId} is null)`,
    ),
    index('stored_files_tenant_idx').on(t.tenantId, t.tipo),
    index('stored_files_paciente_idx').on(t.tenantId, t.patientId),
  ],
);

/** Execuções do backup do host (RNF-05). Escrita só pelo script (superusuário local); o app só lê. */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: text('tipo').notNull(),
    ok: boolean('ok').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    detalhe: text('detalhe'),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('backup_runs_tipo_valido', sql`${t.tipo} in ('banco', 'arquivos')`),
    index('backup_runs_tipo_idx').on(t.tipo, t.concluidoEm),
  ],
);

/**
 * P09-02 (b): ações sensíveis do admin sobre contas — hoje só o reinício do 2FA e, pelo painel, o código do 2FA da
 * própria admin recusado ao pedir esse reinício (code review do PR #22, item 1: a recusa fica registrada como a da
 * assinatura do Plano 10A; sem conta-alvo, porque o código é conferido antes de procurar o e-mail), e as ações de IA do
 * Plano 11 (liberar, bloquear e ajustar a cota de um consultório: `alvo_tenant_id`, sem conta-alvo). Sem tenant_id (fora
 * da RLS; o admin não toca tabela 🔒). Para a aplicação, só INSERT e SELECT (0096). Sem e-mail: a conta é o id e o papel.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Nulo quando veio do comando no servidor (`admin:reiniciar-2fa`, sem sessão). */
    adminUserId: uuid('admin_user_id'),
    acao: text('acao').notNull(),
    /** Nulos só em `codigo_2fa_recusado` (admin_actions_alvo_coerente). */
    alvoUserId: uuid('alvo_user_id'),
    alvoPapel: text('alvo_papel'),
    /** Plano 11 (D6): consultório-alvo das ações de IA (liberar, bloquear, ajustar a cota). */
    alvoTenantId: uuid('alvo_tenant_id').references(() => tenants.id),
    origem: text('origem').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('admin_actions_acao_valida', sql`${t.acao} in ('reiniciar_2fa', 'codigo_2fa_recusado', 'liberar_ia', 'bloquear_ia', 'ajustar_cota_ia')`),
    check(
      'admin_actions_alvo_coerente',
      sql`((${t.acao} = 'reiniciar_2fa') = (${t.alvoUserId} is not null and ${t.alvoPapel} is not null))
          and ((${t.acao} in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia')) = (${t.alvoTenantId} is not null))
          and ((${t.acao} in ('liberar_ia', 'bloquear_ia', 'ajustar_cota_ia')) <= (${t.alvoUserId} is null and ${t.alvoPapel} is null))`,
    ),
    check('admin_actions_origem_valida', sql`${t.origem} in ('admin', 'cli')`),
    check('admin_actions_autor_coerente', sql`(${t.origem} = 'cli') = (${t.adminUserId} is null)`),
  ],
);
