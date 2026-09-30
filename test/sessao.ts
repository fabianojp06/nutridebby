import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { account, user } from '@/db/schema';
import type { Auth } from '@/lib/auth';
import { hashPassword } from '@/lib/password.server';

export const SENHA_TESTE = 'Nutri2026segura';

/** Login pelo handler real do Better Auth; devolve o cookie `nd.session_token=…`. */
export async function entrar(auth: Auth, email: string, senha = SENHA_TESTE, ip = `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`): Promise<string> {
  const res = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password: senha }),
    }),
  );
  if (res.status !== 200) throw Object.assign(new Error(`login falhou: HTTP ${res.status}`), { status: res.status, body: await res.text() });
  return res.headers.get('set-cookie')!.match(/nd\.session_token=[^;]+/)![0];
}

/** Cria usuário com senha e entra. `twoFactorEnabled` é ligado depois do login (o admin passa em evaluateSession). */
export async function criarEEntrar(
  db: Db,
  auth: Auth,
  opts: { appRole: 'admin' | 'nutri' | 'paciente'; tenantId?: string; twoFactorEnabled?: boolean },
): Promise<{ id: string; email: string; cookie: string }> {
  const id = randomUUID();
  const email = `${opts.appRole}-${id.slice(0, 8)}@teste.dev`;
  await db.insert(user).values({ id, name: `Teste ${opts.appRole}`, email, emailVerified: true, appRole: opts.appRole, tenantId: opts.tenantId ?? null });
  await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(SENHA_TESTE) });
  const cookie = await entrar(auth, email);
  if (opts.twoFactorEnabled) await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id));
  return { id, email, cookie };
}
