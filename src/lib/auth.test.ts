import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { account, user } from '@/db/schema';
import { createAuth } from './auth';
import { hashPassword } from './password.server';
import { setPasswordLinkSink } from './password-links';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
const email = `admin-${randomUUID().slice(0, 8)}@teste.dev`;
const senha = 'Nutri2026segura';

const post = (path: string, body: unknown, ip: string) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const id = randomUUID();
  await app.db.insert(user).values({ id, name: 'Admin', email, emailVerified: true, appRole: 'admin' });
  await app.db.insert(account).values({
    id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha),
  });
});
afterAll(() => app.pool.end());

describe('Better Auth (US-002, RNF-06)', () => {
  it('guarda a senha em argon2id', async () => {
    const [row] = await app.db.select({ p: account.password }).from(account).innerJoin(user, eq(user.id, account.userId)).where(eq(user.email, email));
    expect(row.p).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('login com senha correta devolve sessão', async () => {
    const res = await post('/sign-in/email', { email, password: senha }, '10.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/nd\.session_token=/);
  });

  it('cadastro público está desativado', async () => {
    const res = await post('/sign-up/email', { email: 'x@y.dev', password: senha, name: 'X' }, '10.0.0.2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
  });

  it('bloqueia a 6ª tentativa em 15 min no mesmo IP com HTTP 429', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) {
      const res = await post('/sign-in/email', { email, password: 'errada-123456' }, ip);
      expect(res.status).toBe(401);
    }
    const sexta = await post('/sign-in/email', { email, password: senha }, ip);
    expect(sexta.status).toBe(429);
  });

  it('recuperação de senha responde igual para e-mail inexistente e não vaza o link no log', async () => {
    const links: string[] = [];
    const restore = setPasswordLinkSink(({ url }) => { links.push(url); });
    try {
      const a = await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.4');
      const b = await post('/request-password-reset', { email: 'ninguem@teste.dev', redirectTo: '/definir-senha' }, '10.0.0.4');
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(links).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('recusa nova senha fora da política na redefinição', async () => {
    let url = '';
    const restore = setPasswordLinkSink((l) => { url = l.url; });
    await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.5');
    restore();
    const token = new URL(url).pathname.split('/').pop()!;
    const res = await post('/reset-password', { newPassword: 'curta1', token }, '10.0.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'A senha precisa ter pelo menos 10 caracteres.' });
  });
});
