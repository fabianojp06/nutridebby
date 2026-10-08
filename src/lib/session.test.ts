import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, session, tenants, user } from '@/db/schema';
import { makeDb } from '../../test/db';
import { criarEEntrar } from '../../test/sessao';
import { getAuth, slideSession } from './auth';
import { logger } from './logger';
import { hashPassword } from './password.server';
import { PATIENT_SESSION_MS, STAFF_IDLE_MS, STAFF_MAX_MS } from './session-rules';

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
// slideSession real, mas trocável por uma falha num teste (R51)
vi.mock('./auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./auth')>();
  return { ...orig, slideSession: vi.fn(orig.slideSession) };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireUser } = await import('./session');

const MIN = 60_000;
const H = 60 * MIN;
const senha = 'Nutri2026segura';
const auth = getAuth();
const db = getDb();

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
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

/** Coloca a sessão do usuário num estado de inatividade simulado (`createdAtAgoMs`: há quanto tempo foi o login). */
async function envelhecer(userId: string, updatedAgoMs: number, expiresInMs: number, createdAtAgoMs = updatedAgoMs) {
  const now = Date.now();
  await db
    .update(session)
    .set({ updatedAt: new Date(now - updatedAgoMs), expiresAt: new Date(now + expiresInMs), createdAt: new Date(now - createdAtAgoMs) })
    .where(eq(session.userId, userId));
}

async function lerSessao(userId: string) {
  const rows = await db.select({ updatedAt: session.updatedAt, expiresAt: session.expiresAt, createdAt: session.createdAt }).from(session).where(eq(session.userId, userId));
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
  it('login cria sessão da equipe com 30 min e a do paciente com 30 dias (P12-14)', async () => {
    const nutri = await entrar('nutri');
    const paciente = await entrar('paciente');
    perto((await lerSessao(nutri.id)).expiresAt, Date.now() + STAFF_IDLE_MS);
    perto((await lerSessao(paciente.id)).expiresAt, Date.now() + PATIENT_SESSION_MS);
  });

  it('(a) equipe com 31 min sem atividade é recusada em getSession, /api/auth/get-session e requireUser', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 31 * MIN, -1 * MIN);
    // leitura sem disableRefresh (antes do fix, empurrava updatedAt para agora)
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    const http = await getSessionHttp(cookie);
    expect(await http.json()).toBeNull();
    expect(await redirectDe(requireComo(cookie, ['nutri'], '/painel'))).toBe('/entrar?expirada=1&volta=%2Fpainel');
    expect(await lerSessao(id)).toBeUndefined();
  });

  it('(i) sessão antiga da equipe (31 min ociosa, expiresAt de 12 h no futuro) não é revivida por getSession e é recusada com o motivo', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 31 * MIN, 11 * H);
    const antes = await lerSessao(id);
    // leituras do Better Auth (API e HTTP) não renovam mais nada
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    await getSessionHttp(cookie);
    expect(await lerSessao(id)).toEqual(antes);
    expect(await redirectDe(requireComo(cookie, ['nutri'], '/painel'))).toBe('/entrar?motivo=inatividade&volta=%2Fpainel');
    expect(await lerSessao(id)).toBeUndefined(); // signOut apagou a sessão
  });

  it('limite de 8 h: uso contínuo (atividade há 1 min) com login há mais de 8 h é recusado com o motivo "limite" (P12-14)', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 1 * MIN, 29 * MIN, 8 * H + MIN);
    expect(await redirectDe(requireComo(cookie, ['nutri'], '/painel'))).toBe('/entrar?motivo=limite&volta=%2Fpainel');
    expect(await lerSessao(id)).toBeUndefined();
  });

  it('a renovação da equipe não passa do limite de 8 h: expiresAt = createdAt + 8 h (P12-14)', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 6 * MIN, 24 * MIN, 8 * H - 10 * MIN);
    await requireComo(cookie, ['nutri'], '/painel');
    const s = await lerSessao(id);
    perto(s.updatedAt, Date.now());
    expect(new Date(s.expiresAt).getTime()).toBe(new Date(s.createdAt).getTime() + STAFF_MAX_MS);
  });

  it('a migration 0103 limita sessões abertas da equipe a LEAST(updatedAt + 30 min, createdAt + 8 h) e não mexe no paciente (P12-14)', async () => {
    const ociosa = await entrar('nutri');
    const longa = await entrar('nutri');
    const ativa = await entrar('nutri');
    const paciente = await entrar('paciente');
    await envelhecer(ociosa.id, 2 * H, 10 * H, 3 * H);
    await envelhecer(longa.id, 1 * MIN, 11 * H, 8 * H + 5 * MIN);
    await envelhecer(ativa.id, 10 * MIN, 11 * H, 1 * H);
    await envelhecer(paciente.id, 13 * H, 29 * 24 * H);
    const pacienteAntes = await lerSessao(paciente.id);
    const dir = path.join(process.cwd(), 'drizzle');
    const sql = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.startsWith('0103_'))!), 'utf8');
    await owner.pool.query(sql);
    const o = await lerSessao(ociosa.id);
    expect(new Date(o.expiresAt).getTime()).toBe(new Date(o.updatedAt).getTime() + STAFF_IDLE_MS);
    const l = await lerSessao(longa.id);
    expect(new Date(l.expiresAt).getTime()).toBe(new Date(l.createdAt).getTime() + STAFF_MAX_MS);
    const a = await lerSessao(ativa.id);
    expect(new Date(a.expiresAt).getTime()).toBe(new Date(a.updatedAt).getTime() + STAFF_IDLE_MS);
    // /api/auth recusa nativamente a ociosa e a de mais de 8 h; a ativa segue valendo
    expect(await getSessionHttp(ociosa.cookie).then((r) => r.json())).toBeNull();
    expect(await getSessionHttp(longa.cookie).then((r) => r.json())).toBeNull();
    expect((await getSessionHttp(ativa.cookie).then((r) => r.json())).user.id).toBe(ativa.id);
    expect(await lerSessao(paciente.id)).toEqual(pacienteAntes);
  });

  it('(i) a migration 0005 limitava sessões antigas da equipe a updatedAt + 12 h (e não mexia no paciente)', async () => {
    const nutri = await entrar('nutri');
    const paciente = await entrar('paciente');
    await envelhecer(nutri.id, 13 * H, 29 * 24 * H);
    await envelhecer(paciente.id, 13 * H, 29 * 24 * H);
    const pacienteAntes = await lerSessao(paciente.id);
    const dir = path.join(process.cwd(), 'drizzle');
    const sql = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.startsWith('0005_'))!), 'utf8');
    await owner.pool.query(sql);
    const n = await lerSessao(nutri.id);
    expect(new Date(n.expiresAt).getTime()).toBe(new Date(n.updatedAt).getTime() + 12 * H); // a regra da época (Plano 01)
    expect(await getSessionHttp(nutri.cookie).then((r) => r.json())).toBeNull(); // /api/auth recusa nativamente
    expect(await lerSessao(paciente.id)).toEqual(pacienteAntes);
  });

  it('(a) equipe com 31 min sem atividade recebe 401 num endpoint autenticado de /api/auth', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 31 * MIN, -1 * MIN);
    const res = await auth.handler(
      new Request('http://localhost:3000/api/auth/two-factor/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': '10.2.0.2', cookie },
        body: JSON.stringify({ password: senha }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('(b) equipe sem uso há 29 min é aceita e a sessão desliza para agora + 30 min', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 29 * MIN, 1 * MIN);
    const data = await requireComo(cookie, ['nutri'], '/painel');
    expect(data.user.id).toBe(id);
    const s = await lerSessao(id);
    perto(s.updatedAt, Date.now());
    perto(s.expiresAt, Date.now() + STAFF_IDLE_MS);
  });

  it('(b) navegação RSC (cabeçalho RSC: 1) também desliza a sessão da equipe', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 20 * MIN, 10 * MIN);
    await requireComo(cookie, ['nutri'], '/painel', { rsc: '1' });
    perto((await lerSessao(id)).expiresAt, Date.now() + STAFF_IDLE_MS);
  });

  it('dentro da cadência de 5 min a sessão da equipe não é regravada; depois dela, é', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 4 * MIN, STAFF_IDLE_MS - 4 * MIN);
    const antes = await lerSessao(id);
    await requireComo(cookie, ['nutri'], '/painel');
    expect(await lerSessao(id)).toEqual(antes);
    await envelhecer(id, 5 * MIN + 1000, STAFF_IDLE_MS - 5 * MIN);
    await requireComo(cookie, ['nutri'], '/painel');
    perto((await lerSessao(id)).updatedAt, Date.now());
  });

  it('(c) paciente com 13 h sem atividade continua válido e desliza para 30 dias', async () => {
    const { id, cookie } = await entrar('paciente');
    await envelhecer(id, 13 * H, PATIENT_SESSION_MS - 13 * H);
    const data = await requireComo(cookie, ['paciente'], '/p/inicio');
    expect(data.user.id).toBe(id);
    perto((await lerSessao(id)).expiresAt, Date.now() + PATIENT_SESSION_MS);
  });

  it('(ii) chamadas a /api/auth não regravam a sessão nem mandam Set-Cookie (equipe e paciente)', async () => {
    for (const papel of ['nutri', 'paciente'] as const) {
      const { id, cookie } = await entrar(papel);
      await envelhecer(id, 10 * MIN, 20 * MIN);
      const antes = await lerSessao(id);
      const res = await getSessionHttp(cookie);
      expect(res.status).toBe(200);
      expect((await res.json()).user.id).toBe(id);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await lerSessao(id)).toEqual(antes);
    }
  });

  it('expirada mantém no ?volta a página pedida (caminho + query) vinda do proxy', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 31 * MIN, -1 * MIN);
    const url = await redirectDe(requireComo(cookie, ['nutri'], '/painel', { 'x-nd-caminho': '/painel/pacientes?busca=ana' }));
    expect(url).toBe('/entrar?expirada=1&volta=%2Fpainel%2Fpacientes%3Fbusca%3Dana');
  });

  it('?volta vindo do cabeçalho passa por safeReturnPath (destino externo cai no caminho da página)', async () => {
    req.headers = new Headers({ 'x-nd-caminho': '/.//evil.com' });
    expect(await redirectDe(requireUser(['nutri'], '/painel'))).toBe('/entrar?volta=%2Fpainel');
  });

  it('falha ao renovar a sessão é registrada (sem token/cookie) e a página segue autenticada', async () => {
    const { id, cookie } = await entrar('nutri');
    await envelhecer(id, 10 * MIN, 20 * MIN);
    vi.mocked(slideSession).mockRejectedValueOnce(new Error('banco indisponível'));
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const data = await requireComo(cookie, ['nutri'], '/painel');
      expect(data.user.id).toBe(id);
      expect(aviso).toHaveBeenCalledTimes(1);
      const [obj, msg] = aviso.mock.calls[0] as unknown as [Record<string, unknown>, string];
      expect(msg).toBe('falha ao renovar a sessão');
      expect(obj).toEqual({ erro: 'Error', userId: id }); // só o nome do erro (RNF-11): a mensagem não vai ao log
      const token = decodeURIComponent(cookie.split('=')[1]).split('.')[0];
      expect(JSON.stringify(aviso.mock.calls)).not.toContain(token);
    } finally {
      aviso.mockRestore();
    }
  });

  it('sem cookie de sessão → login com ?volta', async () => {
    req.headers = new Headers();
    expect(await redirectDe(requireUser(['nutri'], '/painel'))).toBe('/entrar?volta=%2Fpainel');
  });
});

describe('conta suspensa (RN-15)', () => {
  it('sessão aberta de conta suspensa vai para /indisponivel (Review Focus 5)', async () => {
    const [t] = await db.insert(tenants).values({ slug: `susp-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Susp' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, t.id)); // sem revogar: simula a corrida
    expect(await redirectDe(requireComo(n.cookie, ['nutri'], '/painel'))).toBe('/indisponivel');
  });
});

describe('papel errado (P09-03)', () => {
  it('nutricionista no portal e no admin, paciente no painel → aviso de outro papel com o papel esperado; nunca a home calada', async () => {
    const [t] = await db.insert(tenants).values({ slug: `pap-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Pap' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect(await redirectDe(requireComo(n.cookie, ['paciente'], '/p/inicio'))).toBe('/conta/outro-papel?esperado=paciente');
    expect(await redirectDe(requireComo(n.cookie, ['admin'], '/admin'))).toBe('/conta/outro-papel?esperado=admin');
    const p = await criarEEntrar(db, auth, { appRole: 'paciente', tenantId: t.id });
    expect(await redirectDe(requireComo(p.cookie, ['nutri'], '/painel'))).toBe('/conta/outro-papel?esperado=nutri');
  });
});
