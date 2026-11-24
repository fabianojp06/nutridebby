import { sql } from 'drizzle-orm';
import { check, date, foreignKey, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { jsonbSeguro } from '../jsonb-seguro';
import { exams } from './pacientes';

/**
 * Plano 22 (spec §9.5, RN-383, EP-D18, EP-D19, EP-D41): nota de interpretação do exame, só de inclusão — a nota em vigor é a
 * de maior versão; `texto` nulo = "Apagar nota". UPDATE, DELETE e TRUNCATE revogados (rls_exames_catalogo); as linhas saem
 * só com o exame, pela cascata da FK composta. `criado_por`/`criado_em` do gatilho exam_interpretacoes_regras (a usuária da
 * sessão `nutri`, o relógio do banco), sem FK para `user` (a semente do E2E recria as contas). Só a equipe (staff_only);
 * auditada (entidade `exames_nota`, EP-D61). Fica fora de `pacientes.ts`, disputado por outros planos (EP-D60).
 */
export const examInterpretacoes = pgTable(
  'exam_interpretacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    examId: uuid('exam_id').notNull(),
    versao: smallint('versao').notNull(),
    texto: text('texto'),
    criadoPor: uuid('criado_por').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.patientId, t.examId],
      foreignColumns: [exams.tenantId, exams.patientId, exams.id],
      name: 'exam_interpretacoes_exame_fk',
    }).onDelete('cascade'),
    check('exam_interpretacoes_versao_valida', sql`${t.versao} >= 1`),
    check('exam_interpretacoes_texto_tamanho', sql`${t.texto} is null or char_length(${t.texto}) between 1 and 2000`),
    unique('exam_interpretacoes_versao_unique').on(t.tenantId, t.examId, t.versao),
  ],
);
export type ExamInterpretacaoRow = typeof examInterpretacoes.$inferSelect;

/**
 * Plano 22 (spec §9.5a, RN-378, EP-D41): o estado do exame de ANTES de cada edição (`valores` inteiro, com `iaTarefaId`), só
 * de inclusão como a nota. `justificativa` nula só na edição que só acrescenta linhas. `alterado_por`/`alterado_em` do
 * gatilho exam_versoes_regras, sem FK. Só a equipe (staff_only); auditada (entidade `exames_versoes`); sai na exportação sem
 * a justificativa.
 */
export const examVersoes = pgTable(
  'exam_versoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    examId: uuid('exam_id').notNull(),
    versao: smallint('versao').notNull(),
    titulo: text('titulo').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    valores: jsonbSeguro('valores').$type<(typeof exams.$inferSelect)['valores']>().notNull(),
    justificativa: text('justificativa'),
    alteradoPor: uuid('alterado_por').notNull(),
    alteradoEm: timestamp('alterado_em', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.patientId, t.examId],
      foreignColumns: [exams.tenantId, exams.patientId, exams.id],
      name: 'exam_versoes_exame_fk',
    }).onDelete('cascade'),
    check('exam_versoes_versao_valida', sql`${t.versao} >= 1`),
    check('exam_versoes_justificativa_tamanho', sql`${t.justificativa} is null or char_length(${t.justificativa}) between 5 and 500`),
    // revisão da P22-01: os mesmos limites de `exams` (título 1–120) e `valores` sempre lista (case… else false: 23514, nunca 22023)
    check('exam_versoes_titulo_tamanho', sql`char_length(${t.titulo}) between 1 and 120`),
    check('exam_versoes_valores', sql`case when jsonb_typeof(${t.valores}) = 'array' then true else false end`),
    unique('exam_versoes_versao_unique').on(t.tenantId, t.examId, t.versao),
  ],
);
export type ExamVersaoRow = typeof examVersoes.$inferSelect;
