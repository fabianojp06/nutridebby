import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, tenants, user } from '@/db/schema';
import { hashPassword } from '@/lib/password.server';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';

export const E2E_ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_NUTRI = { email: 'nutri-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_RECUPERA = { email: 'recupera-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_ADMIN_PLATAFORMA = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };

const db = getDb();

// Consultório das nutricionistas do E2E, já com o DPA aceito (US-002)
const [consultorio] = await db
  .insert(tenants)
  .values({ slug: 'e2e-consultorio', nomeExibicao: 'Consultório E2E', crn: 'CRN-3 12345', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
  .onConflictDoUpdate({
    target: tenants.slug,
    set: { status: 'ativa', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), corPrimaria: null, logoPath: null, armazenamentoBytes: 0 },
  })
  .returning({ id: tenants.id });

await db.delete(user).where(eq(user.email, E2E_ADMIN.email));
const adminId = randomUUID();
await db.insert(user).values({ id: adminId, name: 'Admin E2E', email: E2E_ADMIN.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword(E2E_ADMIN.password) });

await db.delete(user).where(eq(user.email, E2E_NUTRI.email));
const nutriId = randomUUID();
await db.insert(user).values({ id: nutriId, name: 'Nutri E2E', email: E2E_NUTRI.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: await hashPassword(E2E_NUTRI.password) });

await db.delete(user).where(eq(user.email, E2E_RECUPERA.email));
const recuperaId = randomUUID();
await db.insert(user).values({ id: recuperaId, name: 'Recupera E2E', email: E2E_RECUPERA.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: recuperaId, accountId: recuperaId, providerId: 'credential', password: await hashPassword(E2E_RECUPERA.password) });

await db.delete(user).where(eq(user.email, E2E_ADMIN_PLATAFORMA.email));
const admin2Id = randomUUID();
await db.insert(user).values({ id: admin2Id, name: 'Admin Plataforma E2E', email: E2E_ADMIN_PLATAFORMA.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: admin2Id, accountId: admin2Id, providerId: 'credential', password: await hashPassword(E2E_ADMIN_PLATAFORMA.password) });

await closeDb();
console.log('Seed E2E pronto.');
