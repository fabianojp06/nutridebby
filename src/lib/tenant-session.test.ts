import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { novoTenant } from '../../test/pacientes';
import { pacienteComConta } from '../../test/portal';
import { criarEEntrar, entrar } from '../../test/sessao';
import { getAuth } from './auth';

const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
// F8: conta as leituras de `tenants` feitas por requireNutri (implementação real por baixo)
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, buscarTenant: vi.fn(real.buscarTenant), getTenantStatus: vi.fn(real.getTenantStatus) };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireApiNutri, requireNutri } = await import('./tenant-session');
const tenantStatus = await import('@/modules/plataforma/tenant-status');
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

  it('P08-06: o consultório com o DPA 0.1 provisório aceito vai a /painel/dpa (API: 403); aceitar o 1.0 libera', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await db.update(tenants).set({ dpaVersao: '0.1-provisorio', dpaAceitoEm: new Date('2026-10-01T10:00:00Z') }).where(eq(tenants.id, tenant.id));
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
    const api = await requireApiNutri(new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers: { cookie: nutri.cookie } }));
    expect(api.ok ? null : api.response.status).toBe(403);
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    await expect(requireNutri('/painel')).resolves.toMatchObject({ tenant: { id: tenant.id, dpaVersao: '1.0' } });
  });
});

describe('requireNutri lê o tenant uma vez só (F8)', () => {
  it('a linha usada para o RN-15 é a mesma devolvida (uma leitura de tenants)', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    vi.mocked(tenantStatus.buscarTenant).mockClear();
    vi.mocked(tenantStatus.getTenantStatus).mockClear();
    await expect(requireNutri('/painel')).resolves.toMatchObject({ tenant: { id: tenant.id } });
    expect(tenantStatus.buscarTenant).toHaveBeenCalledTimes(1);
    expect(tenantStatus.getTenantStatus).not.toHaveBeenCalled();
  });
});

describe('requireApiNutri (F7)', () => {
  const pedir = (cookie?: string) =>
    new Request('http://localhost:3000/api/painel/marca/logo', {
      method: 'POST',
      headers: { ...(cookie ? { cookie } : {}), 'x-forwarded-for': '203.0.113.21' },
    });

  it('sem sessão → 401', async () => {
    const r = await requireApiNutri(pedir());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('sem o DPA da versão atual → 403 com a mensagem do DPA; com ele, devolve tenant e contexto com ator e IP', async () => {
    const { tenant, nutri } = await nutriComTenant();
    const sem = await requireApiNutri(pedir(nutri.cookie));
    expect(sem.ok).toBe(false);
    if (!sem.ok) {
      expect(sem.response.status).toBe(403);
      expect(await sem.response.json()).toEqual({ erro: 'Aceite o contrato de tratamento de dados para continuar.' });
    }
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    const com = await requireApiNutri(pedir(nutri.cookie));
    expect(com.ok).toBe(true);
    if (com.ok) {
      expect(com.tenant.id).toBe(tenant.id);
      expect(com.ctx).toEqual({ tenantId: tenant.id, role: 'nutri', actorUserId: nutri.id, ip: '203.0.113.21' });
    }
  });

  it('conta suspensa → 403 "Conta temporariamente indisponível"', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, tenant.id));
    const r = await requireApiNutri(pedir(nutri.cookie));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await r.response.json()).toEqual({ erro: 'Conta temporariamente indisponível' });
  });

  it('Plano 20 (T8): a recusa diz o motivo — sem sessão, DPA pendente ou papel — sem a rota ler o corpo', async () => {
    const motivo = async (cookie?: string) => {
      const r = await requireApiNutri(pedir(cookie));
      return r.ok ? 'ok' : [r.motivo, r.response.status];
    };
    expect(await motivo()).toEqual(['sem_sessao', 401]);
    const { tenant, nutri } = await nutriComTenant();
    expect(await motivo(nutri.cookie)).toEqual(['dpa_pendente', 403]);
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    expect(await motivo(nutri.cookie)).toBe('ok');
    const { email } = await pacienteComConta(db, await novoTenant(db));
    expect(await motivo(await entrar(getAuth(), email))).toEqual(['papel', 403]);
    const admin = await criarEEntrar(db, getAuth(), { appRole: 'admin', twoFactorEnabled: true });
    expect(await motivo(admin.cookie)).toEqual(['papel', 403]);
  });
});
