import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, user } from '@/db/schema';
import { hashPassword } from '@/lib/password.server';

export const E2E_ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };

const db = getDb();
await db.delete(user).where(eq(user.email, E2E_ADMIN.email));
const id = randomUUID();
await db.insert(user).values({ id, name: 'Admin E2E', email: E2E_ADMIN.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(E2E_ADMIN.password) });
await closeDb();
console.log('Seed E2E pronto.');
