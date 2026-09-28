import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { criarEEntrar } from '../../test/sessao';
import { requireApiUser } from './api-auth';
import { getAuth } from './auth';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const req = (cookie?: string) =>
  new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers: cookie ? { cookie } : {} });

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
});
