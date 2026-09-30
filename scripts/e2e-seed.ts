import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, user } from '@/db/schema';
import { hashPassword } from '@/lib/password.server';

export const E2E_ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
export const E2E_NUTRI = { email: 'nutri-e2e@nutridebby.test', password: 'Nutri2026segura' };

const db = getDb();

await db.delete(user).where(eq(user.email, E2E_ADMIN.email));
const adminId = randomUUID();
await db.insert(user).values({ id: adminId, name: 'Admin E2E', email: E2E_ADMIN.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: adminId, accountId: adminId, providerId: 'credential', password: await hashPassword(E2E_ADMIN.password) });

await db.delete(user).where(eq(user.email, E2E_NUTRI.email));
const nutriId = randomUUID();
await db.insert(user).values({ id: nutriId, name: 'Nutri E2E', email: E2E_NUTRI.email, emailVerified: true, appRole: 'nutri' });
await db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: await hashPassword(E2E_NUTRI.password) });

await closeDb();
console.log('Seed E2E pronto.');
