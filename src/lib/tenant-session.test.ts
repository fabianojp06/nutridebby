import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { criarEEntrar } from '../../test/sessao';
import { getAuth } from './auth';

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

const { requireNutri } = await import('./tenant-session');
const { registrarAceiteDpa } = await import('@/modules/plataforma/dpa');

const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function nutriComTenant() {
  const [t] = await db.insert(tenants).values({ slug: `rn-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RN' }).returning();
  const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
  req.headers = new Headers({ cookie: n.cookie, 'x-forwarded-for': '203.0.113.20' });
  return { tenant: t, nutri: n };
}

describe('requireNutri', () => {
  it('sem DPA aceito leva para /painel/dpa', async () => {
    await nutriComTenant();
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
  });

  it('com permitirDpaPendente devolve o contexto do tenant com ator e IP', async () => {
    const { tenant, nutri } = await nutriComTenant();
    const r = await requireNutri('/painel/dpa', { permitirDpaPendente: true });
    expect(r.tenant.id).toBe(tenant.id);
    expect(r.ctx).toEqual({ tenantId: tenant.id, role: 'nutri', actorUserId: nutri.id, ip: '203.0.113.20' });
  });

  it('com o DPA da versão atual aceito, entra; versão antiga pede novo aceite', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    await expect(requireNutri('/painel')).resolves.toMatchObject({ tenant: { id: tenant.id } });
    await db.update(tenants).set({ dpaVersao: '0.0-antiga' }).where(eq(tenants.id, tenant.id));
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
  });
});
