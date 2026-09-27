import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { user } from '@/db/schema';
import { getAuth, type Auth } from '@/lib/auth';
import { setPasswordLinkSink } from '@/lib/password-links';
import { normalizeEmail } from '@/lib/text';

export class AdminBootstrapError extends Error {
  override name = 'AdminBootstrapError';
}

export async function createAdmin(
  rawEmail: string,
  deps: { db: Db; auth: Auth } = { db: getDb(), auth: getAuth() },
): Promise<{ userId: string; link: string }> {
  const email = normalizeEmail(rawEmail);
  if (!z.email().safeParse(email).success) throw new AdminBootstrapError('E-mail inválido');

  const existing = await deps.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing.length) throw new AdminBootstrapError('Já existe um usuário com este e-mail');

  const userId = randomUUID();
  await deps.db.insert(user).values({ id: userId, name: 'Administrador', email, emailVerified: true, appRole: 'admin' });

  let link = '';
  const restore = setPasswordLinkSink(({ url }) => {
    link = url;
  });
  try {
    await deps.auth.api.requestPasswordReset({ body: { email, redirectTo: '/definir-senha' } });
  } finally {
    restore();
  }
  if (!link) throw new AdminBootstrapError('Não foi possível gerar o link de definição de senha');
  return { userId, link };
}
