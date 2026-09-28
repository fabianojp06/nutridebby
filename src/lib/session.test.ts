import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, session, user } from '@/db/schema';
import { getAuth } from './auth';
import { hashPassword } from './password.server';
import { PATIENT_SESSION_MS, STAFF_IDLE_MS } from './session-rules';

// Integração RNF-06 pelo caminho real: requireUser → auth.api.getSession → Postgres (Testcontainers).
// Só o que depende do runtime do Next é simulado: headers da requisição e redirect.
const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireUser } = await import('./session');

const H = 60 * 60 * 1000;
const senha = 'Nutri2026segura';
const auth = getAuth();
const db = getDb();

afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

/** Cria usuário com senha, faz login pelo handler real e devolve o cookie e o id. */
async function entrar(appRole: 'nutri' | 'paciente') {
  const id = randomUUID();
  const email = `${appRole}-${id.slice(0, 8)}@teste.dev`;
  await db.insert(user).values({ id, name: appRole, email, emailVerified: true, appRole });
  await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
  const res = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ email, password: senha }),
    }),
  );
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!.match(/nd\.session_token=[^;]+/)![0];
  return { id, cookie };
}

/** Coloca a sessão do usuário num estado de inatividade simulado. */
async function envelhecer(userId: string, updatedAgoMs: number, expiresInMs: number) {
  const now = Date.now();
  await db.update(session).set({ updatedAt: new Date(now - updatedAgoMs), expiresAt: new Date(now + expiresInMs) }).where(eq(session.userId, userId));
}

async function lerSessao(userId: string) {
  const rows = await db.select({ updatedAt: session.updatedAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId));
  return rows[0];
}

const perto = (d: Date | string, alvo: number) => expect(Math.abs(new Date(d).getTime() - alvo)).toBeLessThan(60_000);

async function requireComo(cookie: string, allowed: Parameters<typeof requireUser>[0], path: string, extra: Record<string, string> = {}) {
  req.headers = new Headers({ cookie, ...extra });
  return requireUser(allowed, path);
}

async function redirectDe(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(Redirect);
  return (err as Redirect).url;
}

const getSessionHttp = (cookie: string) =>
  auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie, 'x-forwarded-for': '10.2.0.1' } }));

describe('expiração de sessão por papel (RNF-06, US-002) — integração', () => {
  it('login cria sessão da equipe com 12 h e a do paciente com 30 dias', async () => {
    const nutri = await entrar('nutri');
    const paciente = await entrar('paciente');
    perto((await lerSessao(nutri.id)).expiresAt, Date.now() + STAFF_IDLE_MS);
    perto((await lerSessao(paciente.id)).expiresAt, Date.now() + PATIENT_SESSION_MS);
  });

  it('(a) equipe com 13 h sem atividade é recusada, inclusive numa leitura que renovaria', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 13 * H, -1 * H);
    // leitura com renovação ligada (o que antes empurrava updatedAt para agora)
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    const http = await getSessionHttp(cookie);
    expect(await http.json()).toBeNull();
    expect(await redirectDe(requireComo(cookie, ['nutri'], '/painel'))).toBe('/entrar?expirada=1');
    expect(await lerSessao(id)).toBeUndefined();
  });

  it('(a) equipe com 13 h sem atividade e expiresAt ainda distante (sessão antiga) também expira', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 13 * H, 29 * 24 * H);
    expect(await redirectDe(requireComo(cookie, ['nutri'], '/painel'))).toBe('/entrar?expirada=1');
    expect(await lerSessao(id)).toBeUndefined(); // signOut apagou a sessão
  });

  it('(a) equipe com 13 h sem atividade recebe 401 num endpoint autenticado de /api/auth', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 13 * H, -1 * H);
    const res = await auth.handler(
      new Request('http://localhost:3000/api/auth/two-factor/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': '10.2.0.2', cookie },
        body: JSON.stringify({ password: senha }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('(b) equipe ativa há 11 h é aceita e a sessão desliza para agora + 12 h', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 11 * H, 1 * H);
    const data = await requireComo(cookie, ['nutri'], '/painel');
    expect(data.user.id).toBe(id);
    const s = await lerSessao(id);
    perto(s.updatedAt, Date.now());
    perto(s.expiresAt, Date.now() + STAFF_IDLE_MS);
  });

  it('(b) navegação RSC (cabeçalho RSC: 1) também desliza a sessão da equipe', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 11 * H, 1 * H);
    await requireComo(cookie, ['nutri'], '/painel', { rsc: '1' });
    perto((await lerSessao(id)).expiresAt, Date.now() + STAFF_IDLE_MS);
  });

  it('dentro da cadência de 15 min a sessão não é regravada', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 5 * 60_000, STAFF_IDLE_MS - 5 * 60_000);
    const antes = await lerSessao(id);
    await requireComo(cookie, ['nutri'], '/painel');
    expect(await lerSessao(id)).toEqual(antes);
  });

  it('(c) paciente com 13 h sem atividade continua válido e desliza para 30 dias', async () => {
    const { id, cookie } = await entrar('paciente');
    await envelhecer(id, 13 * H, PATIENT_SESSION_MS - 13 * H);
    const data = await requireComo(cookie, ['paciente'], '/p/inicio');
    expect(data.user.id).toBe(id);
    perto((await lerSessao(id)).expiresAt, Date.now() + PATIENT_SESSION_MS);
  });

  it('renovação do próprio Better Auth em /api/auth/get-session mantém 12 h para a equipe e 30 dias para o paciente', async () => {
    const nutri = await entrar('nutri');
    await envelhecer(nutri.id, 2 * H, 10 * H);
    const n = await (await getSessionHttp(nutri.cookie)).json();
    perto(n.session.expiresAt, Date.now() + STAFF_IDLE_MS);
    perto((await lerSessao(nutri.id)).expiresAt, Date.now() + STAFF_IDLE_MS);

    const paciente = await entrar('paciente');
    await envelhecer(paciente.id, 2 * H, PATIENT_SESSION_MS - 2 * H);
    const p = await (await getSessionHttp(paciente.cookie)).json();
    perto(p.session.expiresAt, Date.now() + PATIENT_SESSION_MS);
  });

  it('sem cookie de sessão → login com ?volta', async () => {
    req.headers = new Headers();
    expect(await redirectDe(requireUser(['nutri'], '/painel'))).toBe('/entrar?volta=%2Fpainel');
  });
});
