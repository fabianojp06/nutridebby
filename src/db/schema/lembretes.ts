import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { tenants } from './platform';

/**
 * Plano 17 (spec §5.3, §5.5): lembretes de rotina por push, configurados pela equipe por paciente. `config` é validada por
 * tipo no módulo (`src/modules/lembretes/config.ts`); `texto` só no suplemento (nome) e no livre — nunca vai ao push nem ao
 * log, e o worker nem o lê. `ligado` é da equipe; `desligado_pelo_paciente_em` é do paciente (autonomia do titular: a equipe
 * não religa). Gatilho lembretes_rotina_regras (0119, refeito na 0127): colunas fixas para todos, a sessão de paciente com conta só
 * muda a própria marca (relógio do banco; `updated_at` pelo `now()`), a sem conta nada, e a sessão `nutri` não a muda e só
 * cria com `criado_por` = a própria usuária. Auditada como `lembretes` ("Lembretes no app").
 */
export const lembretesRotina = pgTable(
  'lembretes_rotina',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull(),
    config: jsonb('config').notNull(),
    texto: text('texto'),
    ligado: boolean('ligado').notNull().default(true),
    /**
     * Marca do paciente (gatilho lembretes_rotina_regras, 0119; lembretes_rotina_sem_apagar, 0120). A equipe NUNCA inclui
     * esta coluna no `set()` de um UPDATE: reenviar o valor lido perde os microssegundos do clock_timestamp() e o gatilho
     * recusa com 42501.
     */
    desligadoPeloPacienteEm: timestamp('desligado_pelo_paciente_em', { withTimezone: true }),
    /** Quem criou (a usuária da sessão). Sem FK, como audit_log.actor_user_id. */
    criadoPor: uuid('criado_por').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('lembretes_rotina_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'lembretes_rotina_paciente_fk' }),
    check('lembretes_rotina_tipo_valido', sql`${t.tipo} in ('agua', 'refeicoes', 'suplemento', 'livre')`),
    check(
      'lembretes_rotina_texto_por_tipo',
      sql`(${t.tipo} in ('agua', 'refeicoes') and ${t.texto} is null) or (${t.tipo} = 'suplemento' and ${t.texto} is not null and char_length(btrim(${t.texto})) between 1 and 60) or (${t.tipo} = 'livre' and ${t.texto} is not null and char_length(btrim(${t.texto})) between 1 and 120)`,
    ),
    // água e refeições: um por paciente; suplemento e livre, vários (o limite de 5 é do módulo)
    uniqueIndex('lembretes_rotina_um_por_tipo').on(t.tenantId, t.patientId, t.tipo).where(sql`${t.tipo} in ('agua', 'refeicoes')`),
  ],
);
export type LembreteRotinaRow = typeof lembretesRotina.$inferSelect;

/**
 * Plano 17 (§5.5): a marca do último slot enviado, uma linha por lembrete, atualizada no lugar — escrita só pelo worker
 * (gatilho lembretes_rotina_envios_do_worker, 0119), STAFF_ONLY e sem gatilho de auditoria (AUDIT_EXCEPTIONS: cada push
 * viraria uma linha de audit_log). Apagada só pelo worker ou junto com o lembrete (ON DELETE CASCADE; gatilho
 * lembretes_rotina_envios_sem_apagar, TRI-17-20 #5).
 */
export const lembretesRotinaEnvios = pgTable(
  'lembretes_rotina_envios',
  {
    lembreteId: uuid('lembrete_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    ultimoSlotEm: timestamp('ultimo_slot_em', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.patientId, t.lembreteId],
      foreignColumns: [lembretesRotina.tenantId, lembretesRotina.patientId, lembretesRotina.id],
      name: 'lembretes_rotina_envios_lembrete_fk',
    }).onDelete('cascade'),
  ],
);
