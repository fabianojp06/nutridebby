import { date, foreignKey, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { tenants } from './platform';

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
