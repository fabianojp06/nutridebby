import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { account, consents, patients, user, type PatientRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { hashPassword } from '@/lib/password.server';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { novoPaciente, type TenantDeTeste } from './pacientes';
import { SENHA_TESTE } from './sessao';

/** Paciente com conta de login ligada (como depois do convite aceito, US-011). `userId` reaproveita uma conta existente. */
export async function pacienteComConta(
  db: Db,
  T: TenantDeTeste,
  extra: Partial<typeof patients.$inferInsert> & { userId?: string; semTermo?: boolean } = {},
): Promise<{ paciente: PatientRow; userId: string; email: string }> {
  let userId = extra.userId;
  let email = extra.email;
  if (!userId) {
    userId = randomUUID();
    email ??= `pac-${userId.slice(0, 8)}@teste.dev`;
    await db.insert(user).values({ id: userId, name: 'Ana Souza', email, emailVerified: true, appRole: 'paciente' });
    await db.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: await hashPassword(SENHA_TESTE) });
  } else {
    email ??= (await db.select({ email: user.email }).from(user).where(eq(user.id, userId)))[0].email;
  }
  const { semTermo, ...colunas } = extra;
  const paciente = await novoPaciente(db, T.ctx, { ...colunas, email, userId });
  await withTenant(T.ctx, (tx) => tx.update(patients).set({ userId }).where(eq(patients.id, paciente.id)), db);
  if (!semTermo) await db.insert(consents).values({ userId, tenantId: T.tenantId, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
  return { paciente: { ...paciente, userId }, userId, email: email! };
}
