import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { TOTP } from 'otpauth';
import { makeDb } from '../../test/db';
import { account, twoFactor, user } from '@/db/schema';
import { createAuth } from './auth';
import { hashPassword } from './password.server';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
const email = `twofa-${randomUUID().slice(0, 8)}@teste.dev`;
const senha = 'Nutri2026segura';
let cookie = '';

const call = (path: string, body: unknown, ip = '10.1.0.1') =>
  auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: 'http://localhost:3000', cookie },
    body: JSON.stringify(body),
  }));
const cookiesOf = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  const id = randomUUID();
  await app.db.insert(user).values({ id, name: 'Admin', email, emailVerified: true, appRole: 'admin' });
  await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
  cookie = cookiesOf(await call('/sign-in/email', { email, password: senha }));
});
afterAll(() => app.pool.end());

describe('2FA TOTP (US-003)', () => {
  let secret = '';
  it('ativar gera URI TOTP e 10 códigos de recuperação', async () => {
    const res = await call('/two-factor/enable', { password: senha });
    const body = await res.json();
    expect(body.backupCodes).toHaveLength(10);
    secret = new URL(body.totpURI).searchParams.get('secret')!;
    expect(secret).toBeTruthy();
  });

  it('confirmar com código correto ativa o 2FA', async () => {
    const code = new TOTP({ secret, digits: 6, period: 30 }).generate();
    const res = await call('/two-factor/verify-totp', { code });
    expect(res.status).toBe(200);
    const [u] = await app.db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.email, email));
    expect(u.on).toBe(true);
  });

  it('o segredo não fica em texto puro no banco', async () => {
    const [row] = await app.db.select({ s: twoFactor.secret }).from(twoFactor).innerJoin(user, eq(user.id, twoFactor.userId)).where(eq(user.email, email));
    expect(row.s).not.toBe(secret);
  });

  it('login com 2FA ativo pede o código antes de criar a sessão', async () => {
    cookie = '';
    const res = await call('/sign-in/email', { email, password: senha }, '10.1.0.2');
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
  });
});
