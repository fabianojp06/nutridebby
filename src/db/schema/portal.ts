import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { REFEICOES_DO_DIARIO, RESPOSTAS_DO_DIARIO } from '../../modules/portal/diario-constantes'; // relativo: o drizzle-kit não resolve o alias @/
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

/** CS-02 / D9: no máximo uma linha por paciente por dia (no fuso do tenant) em que ele abriu o portal. */
export const accessEvents = pgTable(
  'access_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    dia: date('dia', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('access_events_dia_unique').on(t.tenantId, t.patientId, t.dia),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'access_events_paciente_fk' }),
  ],
);

export type AccessEventRow = typeof accessEvents.$inferSelect;

/** US-042 / US-043 (§7 + desvios): registro do diário com foto convertida no worker e comentário da nutricionista. */
export const diaryEntries = pgTable(
  'diary_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
    refeicao: text('refeicao').notNull(),
    texto: text('texto'),
    /** JPEG convertido (≤ 1600 px, sem EXIF/GPS) — o único que o portal e o painel assinam. */
    fotoPath: text('foto_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    /** Original enviado (JPEG/PNG/HEIC) até a conversão; nunca é servido. */
    fotoOriginalPath: text('foto_original_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    fotoStatus: text('foto_status').notNull().default('sem_foto'),
    /** Plano 16 (RN-197): resposta à refeição do plano ("Comi assim" / "Comi outra coisa"); null = registro comum. */
    resposta: text('resposta'),
    /** Plano 16: "{nome} · {HH:MM}" da refeição do plano — CÓPIA, não FK (a refeição pode mudar numa publicação nova). */
    refeicaoDoPlano: text('refeicao_do_plano'),
    comentarioNutri: text('comentario_nutri'),
    comentadoEm: timestamp('comentado_em', { withTimezone: true }),
    vistoPelaNutriEm: timestamp('visto_pela_nutri_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('diary_entries_refeicao_valida', sql`${t.refeicao} in (${sql.raw(REFEICOES_DO_DIARIO.map((r) => `'${r}'`).join(', '))})`),
    check('diary_entries_texto_tamanho', sql`${t.texto} is null or char_length(${t.texto}) between 1 and 2000`),
    // 'removida': foto apagada pelo pedido de exclusão (US-018, Tarefa 11) — o registro fica
    check('diary_entries_foto_status_valido', sql`${t.fotoStatus} in ('sem_foto', 'processando', 'pronta', 'falhou', 'removida')`),
    // Plano 16: o "Comi assim" (resposta sem texto nem foto) também é conteúdo. `is not distinct from`, não `=`: com a
    // resposta nula o `=` dá NULL, e um CHECK com NULL passa — o registro sem texto, sem foto e sem resposta entraria.
    check('diary_entries_tem_conteudo', sql`${t.texto} is not null or ${t.fotoStatus} <> 'sem_foto' or ${t.resposta} is not distinct from 'como_no_plano'`),
    check('diary_entries_resposta_valida', sql`${t.resposta} is null or ${t.resposta} in (${sql.raw(RESPOSTAS_DO_DIARIO.map((r) => `'${r}'`).join(', '))})`),
    // a refeição do plano vem junto da resposta, e só com ela
    check('diary_entries_refeicao_do_plano', sql`(${t.resposta} is null) = (${t.refeicaoDoPlano} is null) and (${t.refeicaoDoPlano} is null or char_length(${t.refeicaoDoPlano}) between 1 and 80)`),
    // "Comi outra coisa" exige o que foi comido (texto ou foto)
    check('diary_entries_outra_coisa_tem_conteudo', sql`${t.resposta} is distinct from 'outra_coisa' or ${t.texto} is not null or ${t.fotoStatus} <> 'sem_foto'`),
    check('diary_entries_comentario_tamanho', sql`${t.comentarioNutri} is null or char_length(${t.comentarioNutri}) between 1 and 1000`),
    check('diary_entries_foto_do_tenant', sql`${t.fotoPath} is null or ${t.fotoPath} like ${t.tenantId}::text || '/diario_foto/%'`),
    check('diary_entries_original_do_tenant', sql`${t.fotoOriginalPath} is null or ${t.fotoOriginalPath} like ${t.tenantId}::text || '/diario_foto_original/%'`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'diary_entries_paciente_fk' }),
    index('diary_entries_paciente_idx').on(t.tenantId, t.patientId, t.dataHora.desc()),
    // US-043: feed da nutricionista (não vistos primeiro, mais recentes)
    index('diary_entries_feed_idx').on(t.tenantId, t.vistoPelaNutriEm, t.dataHora.desc()),
  ],
);

export type DiaryEntryRow = typeof diaryEntries.$inferSelect;
