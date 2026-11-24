import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jsonbSeguro } from '../jsonb-seguro';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

const EMITIDOS_SQL = sql.raw(`('assinado','substituido','cancelado')`);
const EM_ANDAMENTO_SQL = sql.raw(`('rascunho','preparando','aguardando_assinatura')`);

/**
 * Spec de documentos assinados v0.3, §10. Imutabilidade no banco (gatilho app_documento_imutavel, 0091); a sessão de
 * paciente só vê os emitidos (paciente_so_emitidos, 0090) e nunca altera. FKs NO ACTION para stored_files (RN-140): um
 * apagarArquivo avulso sobre um PDF ainda referenciado é recusado. `conteudo` (Zod em prescricao.ts) NÃO tem a justificativa.
 */
export const signedDocuments = pgTable(
  'signed_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull().default('receita'),
    status: text('status').notNull().default('rascunho'),
    versao: smallint('versao').notNull().default(1),
    retificaId: uuid('retifica_id'),
    conteudo: jsonbSeguro('conteudo').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    declaracaoEm: timestamp('declaracao_em', { withTimezone: true }),
    codigo: text('codigo').unique('signed_documents_codigo_unique'),
    basePdfPath: text('base_pdf_path').references(() => storedFiles.caminho),
    basePdfSha256: text('base_pdf_sha256'),
    basePdfBytes: integer('base_pdf_bytes'),
    areaAssinatura: jsonbSeguro('area_assinatura').$type<{ x1: number; y1: number; x2: number; y2: number }>(),
    pdfStatus: text('pdf_status'),
    pdfPedidoEm: timestamp('pdf_pedido_em', { withTimezone: true }),
    pdfPath: text('pdf_path').references(() => storedFiles.caminho),
    pdfSha256: text('pdf_sha256'),
    assinaturaTipo: text('assinatura_tipo'),
    assinaturaEmissor: text('assinatura_emissor'),
    assinanteNome: text('assinante_nome'),
    assinadoEm: timestamp('assinado_em', { withTimezone: true }),
    assinadoPor: uuid('assinado_por'),
    entregueEm: timestamp('entregue_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    substituidoEm: timestamp('substituido_em', { withTimezone: true }),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    /**
     * D4: caminhos das fotos da digitalizada até o worker montar o PDF. `digitalizacao_status`: `recebendo` (um envio em
     * curso trava o documento: dois envios simultâneos não somam fotos), `pendente` (o worker monta) ou `falhou`;
     * `digitalizacao_em` = início do envio, para a varredura expirar `recebendo`/`pendente` esquecidos (D24, Minors).
     */
    digitalizacao: jsonbSeguro('digitalizacao').$type<string[]>(),
    digitalizacaoStatus: text('digitalizacao_status'),
    digitalizacaoEm: timestamp('digitalizacao_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Plano 13 (spec v0.5, §10): o parecer nutricional (F3-05) ao lado da receita
    // Plano 22 (EP-D49): 'solicitacao_exames' entra no CHECK no PR 1 (expansão); rótulo, tipos e telas só no PR 4
    check('signed_documents_tipo_valido', sql`${t.tipo} in ('receita','parecer','solicitacao_exames')`),
    check('signed_documents_status_valido', sql`${t.status} in ('rascunho','preparando','aguardando_assinatura','assinado','substituido','cancelado')`),
    check('signed_documents_codigo_so_fora_do_rascunho', sql`(${t.codigo} is null) = (${t.status} = 'rascunho')`),
    check('signed_documents_codigo_formato', sql`${t.codigo} is null or ${t.codigo} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
    check(
      'signed_documents_emitido_com_pdf',
      sql`${t.anonimizadoEm} is not null or ((${t.pdfPath} is not null and ${t.pdfSha256} is not null and ${t.assinadoEm} is not null and ${t.assinaturaTipo} is not null) = (${t.status} in ${EMITIDOS_SQL}))`,
    ),
    // Plano 10A: só a digitalizada; o Plano 10B troca por ('govbr','icp','digitalizada') numa migration gerada
    check('signed_documents_assinatura_tipo_valida', sql`${t.assinaturaTipo} is null or ${t.assinaturaTipo} in ('digitalizada')`),
    // 'sem_cota' (RNF-143): a tela mostra "Espaço de armazenamento esgotado…" em vez de "Não foi possível gerar o PDF"
    check('signed_documents_pdf_status_valido', sql`${t.pdfStatus} is null or ${t.pdfStatus} in ('pendente','pronto','falhou','sem_cota')`),
    check('signed_documents_digitalizacao_status_valido', sql`${t.digitalizacaoStatus} is null or ${t.digitalizacaoStatus} in ('recebendo','pendente','falhou')`),
    check('signed_documents_sha256_formato', sql`(${t.pdfSha256} is null or ${t.pdfSha256} ~ '^[0-9a-f]{64}$') and (${t.basePdfSha256} is null or ${t.basePdfSha256} ~ '^[0-9a-f]{64}$')`),
    check('signed_documents_textos_tamanho', sql`coalesce(char_length(${t.assinanteNome}), 0) <= 200 and coalesce(char_length(${t.assinaturaEmissor}), 0) <= 200`),
    // 0093 (code review do PR #19, item 5): prefixo exato, sem o "_" coringa do LIKE; o PDF assinado só na pasta dele (o
    // gatilho confere também o tipo do stored_files na ida a "assinado")
    check('signed_documents_arquivos_do_tenant', sql`(${t.basePdfPath} is null or starts_with(${t.basePdfPath}, ${t.tenantId}::text || '/documento_base/')) and (${t.pdfPath} is null or starts_with(${t.pdfPath}, ${t.tenantId}::text || '/documento_assinado/'))`),
    check('signed_documents_versao_positiva', sql`${t.versao} >= 1`),
    unique('signed_documents_tenant_id_unique').on(t.tenantId, t.id),
    unique('signed_documents_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'signed_documents_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId, t.retificaId], foreignColumns: [t.tenantId, t.patientId, t.id], name: 'signed_documents_retifica_fk' }),
    // RN-146 (Plano 13): uma retificação em andamento por documento
    uniqueIndex('signed_documents_retificacao_aberta').on(t.retificaId).where(sql`${t.status} in ${EM_ANDAMENTO_SQL}`),
    index('signed_documents_paciente_idx').on(t.tenantId, t.patientId, t.createdAt.desc()),
    index('signed_documents_status_idx').on(t.tenantId, t.status),
  ],
);
export type SignedDocumentRow = typeof signedDocuments.$inferSelect;

/** D15 da spec: o que o paciente nunca lê (STAFF_ONLY). PK id (o gatilho de auditoria grava entidade_id = id). */
export const signedDocumentNotes = pgTable(
  'signed_document_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull().unique('signed_document_notes_documento_unique'),
    justificativaUso: text('justificativa_uso'),
    motivoCancelamento: text('motivo_cancelamento'),
    /** Plano 13 (Q13-1, SBIS NGS1.12.01): por que a versão nova corrige a anterior. Só numa retificação; fixo do preparo em diante (0105). */
    motivoRetificacao: text('motivo_retificacao'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'signed_document_notes_tamanhos',
      sql`coalesce(char_length(${t.justificativaUso}), 0) <= 2000 and coalesce(char_length(${t.motivoCancelamento}), 0) <= 500 and coalesce(char_length(${t.motivoRetificacao}), 0) <= 500`,
    ),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'signed_document_notes_documento_fk' }).onDelete('cascade'),
  ],
);

/** D11 / D4 da spec: recibo só INSERT (REVOKE UPDATE, DELETE na 0090). */
export const signedDocumentReceipts = pgTable(
  'signed_document_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull(),
    evento: text('evento').notNull(),
    via: text('via').notNull(),
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
    registradoPor: uuid('registrado_por'),
  },
  (t) => [
    check('signed_document_receipts_evento_valido', sql`${t.evento} in ('aberto','recebido')`),
    check('signed_document_receipts_via_valida', sql`${t.via} in ('portal','link_email','pessoalmente')`),
    check('signed_document_receipts_pessoalmente', sql`(${t.via} = 'pessoalmente') = (${t.registradoPor} is not null) and (${t.via} <> 'pessoalmente' or ${t.evento} = 'recebido')`),
    unique('signed_document_receipts_um_por_evento').on(t.documentoId, t.evento),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'signed_document_receipts_documento_fk' }),
  ],
);
export type SignedDocumentReceiptRow = typeof signedDocumentReceipts.$inferSelect;

/** RN-158 / D12: códigos do link de uso único (só HMAC). Escritos pela sessão de paciente sem login (contexto sem conta, N7). */
export const documentAccessCodes = pgTable(
  'document_access_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull(),
    codigoHash: text('codigo_hash').notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    tentativas: smallint('tentativas').notNull().default(0),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    sessaoHash: text('sessao_hash'),
    sessaoExpiraEm: timestamp('sessao_expira_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_access_codes_tentativas', sql`${t.tentativas} between 0 and 5`),
    check('document_access_codes_sessao', sql`(${t.sessaoHash} is null) = (${t.sessaoExpiraEm} is null) and (${t.sessaoHash} is null or ${t.usadoEm} is not null)`),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'document_access_codes_documento_fk' }),
    index('document_access_codes_documento_idx').on(t.tenantId, t.documentoId, t.createdAt.desc()),
  ],
);

/** RN-156 / D8: a única fonte da página pública. Fora da RLS (RLS_EXCEPTIONS); só verificacao.ts a acessa; sem dado do paciente. */
export const documentVerifications = pgTable(
  'document_verifications',
  {
    codigo: text('codigo').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    documentoId: uuid('documento_id').notNull(),
    tipo: text('tipo').notNull(),
    situacao: text('situacao').notNull().default('valido'),
    situacaoEm: timestamp('situacao_em', { withTimezone: true }).notNull().defaultNow(),
    assinadoEm: timestamp('assinado_em', { withTimezone: true }).notNull(),
    emissorNome: text('emissor_nome').notNull(),
    emissorCrn: text('emissor_crn').notNull(),
    assinanteNome: text('assinante_nome'),
    assinaturaTipo: text('assinatura_tipo').notNull(),
    pdfSha256: text('pdf_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_verifications_situacao_valida', sql`${t.situacao} in ('valido','substituido','cancelado','eliminado')`),
    check('document_verifications_codigo_formato', sql`${t.codigo} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
    check('document_verifications_assinante', sql`(${t.assinaturaTipo} = 'digitalizada') = (${t.assinanteNome} is null)`),
    // Plano 10A: só a digitalizada; o Plano 10B amplia (mesma migration que amplia o de signed_documents)
    check('document_verifications_assinatura_tipo_valida', sql`${t.assinaturaTipo} in ('digitalizada')`),
    // Plano 13 (spec v0.5, US-147): a verificação grava o tipo real do documento
    // Plano 22 (EP-D49): 'solicitacao_exames' entra no CHECK no PR 1 (expansão); rótulo, tipos e telas só no PR 4
    check('document_verifications_tipo_valido', sql`${t.tipo} in ('receita','parecer','solicitacao_exames')`),
    unique('document_verifications_documento_unique').on(t.documentoId),
  ],
);
export type DocumentVerificationRow = typeof documentVerifications.$inferSelect;
