import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

/**
 * Plano 12 (spec C v0.3 §13.1, F3-04): exame enviado pelo paciente pelo app. Fica FORA do prontuário até a nutricionista
 * aceitar (vira `exams`). A FK composta para `exams` com `ON DELETE SET NULL (exam_id)` fica só na migration custom 0102
 * (o Drizzle não declara a lista de colunas do SET NULL), como em ia_tarefas (0099). As transições por papel e o "sem
 * apagar" são gatilhos da 0102 (§6.5); as políticas da sessão de paciente também.
 */
export const examSubmissions = pgTable(
  'exam_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    /** Conta do paciente que enviou (sem FK, como data_exports.solicitado_por). */
    enviadoPor: uuid('enviado_por').notNull(),
    status: text('status').notNull().default('processando'),
    dataColeta: date('data_coleta', { mode: 'string' }).notNull(),
    nome: text('nome'),
    /** Dado de saúde (texto do paciente). */
    observacao: text('observacao'),
    /** O PDF limpo (tipo `exame`), em `recebido` e, até a limpeza do worker, em `cancelado` (RN-166); no aceite o ponteiro passa ao exame (um dono só). */
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    motivoRecusa: text('motivo_recusa'),
    motivoRecusaTexto: text('motivo_recusa_texto'),
    motivoFalha: text('motivo_falha'),
    examId: uuid('exam_id'),
    /** ECF.17.01: quem aceitou ou recusou, e quando. */
    revisadoPor: uuid('revisado_por'),
    revisadoEm: timestamp('revisado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'exam_submissions_paciente_fk' }),
    // alvo da FK composta das linhas de arquivo (mesmo tenant e mesmo paciente)
    unique('exam_submissions_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    check('exam_submissions_status_valido', sql`${t.status} in ('processando', 'recebido', 'aceito', 'recusado', 'cancelado', 'expirado', 'falhou')`),
    check('exam_submissions_nome_tamanho', sql`${t.nome} is null or char_length(${t.nome}) between 1 and 120`),
    check('exam_submissions_observacao_tamanho', sql`${t.observacao} is null or char_length(${t.observacao}) between 1 and 500`),
    // Revisão do plano (07/10): também em "cancelado" — a sessão de paciente só muda status/updated_at (gatilho), então o ponteiro
    // sobrevive ao cancelamento até o job exame-envio-limpar soltá-lo no naMesmaTransacao do apagarArquivo (RN-166); o gatilho
    // continua impedindo ponteiro NOVO fora de processando → recebido
    check('exam_submissions_arquivo_valido', sql`${t.arquivoPath} is null or (${t.status} in ('recebido', 'cancelado') and ${t.arquivoPath} like ${t.tenantId}::text || '/exame/%')`),
    check(
      'exam_submissions_recusa',
      sql`(${t.status} = 'recusado') = (${t.motivoRecusa} is not null) and (${t.motivoRecusa} is null or ${t.motivoRecusa} in ('ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido', 'outro'))`,
    ),
    check(
      'exam_submissions_recusa_texto',
      sql`(${t.motivoRecusaTexto} is not null) = (${t.motivoRecusa} is not distinct from 'outro') and (${t.motivoRecusaTexto} is null or char_length(${t.motivoRecusaTexto}) between 1 and 300)`,
    ),
    check('exam_submissions_exame_so_aceito', sql`${t.examId} is null or ${t.status} = 'aceito'`),
    check('exam_submissions_revisao', sql`(${t.status} in ('aceito', 'recusado')) = (${t.revisadoEm} is not null) and (${t.revisadoEm} is null) = (${t.revisadoPor} is null)`),
    check(
      'exam_submissions_falha',
      sql`(${t.status} = 'falhou') = (${t.motivoFalha} is not null) and (${t.motivoFalha} is null or ${t.motivoFalha} in ('conversao', 'paginas', 'cota', 'interrompido'))`,
    ),
    index('exam_submissions_fila_idx').on(t.tenantId, t.status, t.createdAt),
    index('exam_submissions_paciente_idx').on(t.tenantId, t.patientId, t.createdAt.desc()),
  ],
);

export type ExamSubmissionRow = typeof examSubmissions.$inferSelect;

/**
 * Plano 12: os arquivos do envio — os originais do paciente (`original`, tipo `exame_original`, só enquanto o envio está
 * `processando`) e as imagens de página para a revisão (`pagina`, tipo `exame_pagina`, D23). Apagar o arquivo pela API de
 * armazenamento apaga a linha junto (FK `ON DELETE CASCADE`, regra 9).
 */
export const examSubmissionFiles = pgTable(
  'exam_submission_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    arquivoPath: text('arquivo_path')
      .notNull()
      .references(() => storedFiles.caminho, { onDelete: 'cascade' }),
    papel: text('papel').notNull(),
    ordem: integer('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId, t.submissionId], foreignColumns: [examSubmissions.tenantId, examSubmissions.patientId, examSubmissions.id], name: 'exam_submission_files_envio_fk' }).onDelete('cascade'),
    check(
      'exam_submission_files_papel_valido',
      sql`(${t.papel} = 'original' and ${t.arquivoPath} like ${t.tenantId}::text || '/exame_original/%') or (${t.papel} = 'pagina' and ${t.arquivoPath} like ${t.tenantId}::text || '/exame_pagina/%')`,
    ),
    check('exam_submission_files_ordem_valida', sql`${t.ordem} between 1 and 10`),
    uniqueIndex('exam_submission_files_ordem_idx').on(t.submissionId, t.papel, t.ordem),
    unique('exam_submission_files_arquivo_unique').on(t.arquivoPath),
    index('exam_submission_files_envio_idx').on(t.tenantId, t.submissionId),
  ],
);

export type ExamSubmissionFileRow = typeof examSubmissionFiles.$inferSelect;
