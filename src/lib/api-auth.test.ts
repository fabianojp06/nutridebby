import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session, tenants } from '@/db/schema';
import { criarEEntrar } from '../../test/sessao';
import { lerSessaoApi, requireApiUser } from './api-auth';
import { getAuth } from './auth';
import { CABECALHO_CONSULTA } from './consulta-automatica';
import { STAFF_IDLE_MS } from './session-rules';

const MIN = 60_000;

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const req = (cookie?: string, extra: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers: { ...(cookie ? { cookie } : {}), ...extra } });

const H = 60 * 60 * 1000;

/** Coloca a sessão do usuário num estado de inatividade simulado (mesmo padrão de session.test.ts). */
async function envelhecer(userId: string, updatedAgoMs: number, expiresInMs: number) {
  const now = Date.now();
  await db.update(session).set({ updatedAt: new Date(now - updatedAgoMs), expiresAt: new Date(now + expiresInMs) }).where(eq(session.userId, userId));
}

async function lerSessao(userId: string) {
  const rows = await db.select({ updatedAt: session.updatedAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId));
  return rows[0];
}

describe('requireApiUser', () => {
  it('sem sessão → 401', async () => {
    const r = await requireApiUser(req(), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('admin em /api/painel → 403 (US-004 "Admin não vê prontuário")', async () => {
    const a = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const r = await requireApiUser(req(a.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ erro: 'Acesso negado' });
    }
  });

  it('nutricionista de conta ativa passa; a mesma sessão depois da suspensão recebe 403 (Review Focus 5)', async () => {
    const [t] = await db.insert(tenants).values({ slug: `api-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Api' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect((await requireApiUser(req(n.cookie), ['nutri'])).ok).toBe(true);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, t.id));
    const r = await requireApiUser(req(n.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ erro: 'Conta temporariamente indisponível' });
    }
  });

  it('atividade de API desliza a sessão da equipe para agora + 30 min (T7-R2b, P12-14) e devolve os valores gravados', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 20 * MIN, 10 * MIN);
    const r = await requireApiUser(req(n.cookie), ['nutri']);
    expect(r.ok).toBe(true);
    const s = await lerSessao(n.id);
    expect(Math.abs(new Date(s.updatedAt).getTime() - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(new Date(s.expiresAt).getTime() - (Date.now() + STAFF_IDLE_MS))).toBeLessThan(60_000);
    if (r.ok) expect(new Date(r.data.session.expiresAt).getTime()).toBe(new Date(s.expiresAt).getTime());
  });

  it('equipe sem uso há 31 min (sessão aberta antes da regra, expiresAt de 12 h) → 401 e nada é renovado (P12-14)', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 31 * MIN, 11 * H);
    const antes = await lerSessao(n.id);
    const r = await requireApiUser(req(n.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
    expect(await lerSessao(n.id)).toEqual(antes);
  });

  it('lerSessaoApi confere igual, mas não renova (perguntar não é uso, P12-14)', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 20 * MIN, 10 * MIN);
    const antes = await lerSessao(n.id);
    expect((await lerSessaoApi(req(n.cookie), ['nutri'])).ok).toBe(true);
    expect(await lerSessao(n.id)).toEqual(antes);
    await envelhecer(n.id, 31 * MIN, 11 * H);
    const r = await lerSessaoApi(req(n.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('consulta automática da tela (x-nd-consulta: 1) e renovar: false conferem igual, mas não renovam (revisão P12-14)', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 20 * MIN, 10 * MIN);
    const antes = await lerSessao(n.id);
    expect((await requireApiUser(req(n.cookie, { [CABECALHO_CONSULTA]: '1' }), ['nutri'])).ok).toBe(true);
    expect((await requireApiUser(req(n.cookie), ['nutri'], { renovar: false })).ok).toBe(true);
    expect(await lerSessao(n.id)).toEqual(antes);
    // outro valor do cabeçalho não muda nada: a requisição conta como uso
    expect((await requireApiUser(req(n.cookie, { [CABECALHO_CONSULTA]: '0' }), ['nutri'])).ok).toBe(true);
    expect(new Date((await lerSessao(n.id)).updatedAt).getTime()).toBeGreaterThan(new Date(antes.updatedAt).getTime());
    // 31 min sem uso: o polling recebe 401 e a sessão continua como estava
    await envelhecer(n.id, 31 * MIN, 11 * H);
    const vencida = await lerSessao(n.id);
    const r = await requireApiUser(req(n.cookie, { [CABECALHO_CONSULTA]: '1' }), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
    expect(await lerSessao(n.id)).toEqual(vencida);
  });
});
