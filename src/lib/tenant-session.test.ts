import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { permissaoDoFinanceiro, recepcaoComLogin } from '../../test/equipe';
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
// Plano 26 (RN-504): conta as leituras de equipe_membros (uma por requisição, junto com a sessão)
vi.mock('@/modules/plataforma/membro-da-equipe', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/membro-da-equipe')>();
  return { ...real, lerMembroDaEquipe: vi.fn(real.lerMembroDaEquipe) };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireApiEquipe, requireApiNutri, requireEquipe, requireNutri } = await import('./tenant-session');
const membroDaEquipe = await import('@/modules/plataforma/membro-da-equipe');
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

  it.each(['0.1-provisorio', '1.0'])('P08-06/US-309: o consultório com o DPA %s aceito vai a /painel/dpa (API: 403); aceitar o 1.1 libera', async (antiga) => {
    const { tenant, nutri } = await nutriComTenant();
    await db.update(tenants).set({ dpaVersao: antiga, dpaAceitoEm: new Date('2026-10-16T10:00:00Z') }).where(eq(tenants.id, tenant.id));
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
    const api = await requireApiNutri(new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers: { cookie: nutri.cookie } }));
    expect(api.ok ? null : api.response.status).toBe(403);
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    await expect(requireNutri('/painel')).resolves.toMatchObject({ tenant: { id: tenant.id, dpaVersao: '1.1' } });
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

describe('Plano 26: sessão da recepção (RN-501, RN-503, RN-504, RE-D47)', () => {
  /** Consultório com o DPA aceito pela nutricionista e uma conta de recepção ativa com 2FA (cookie na requisição). */
  async function consultorioComRecepcao(o: Parameters<typeof recepcaoComLogin>[3] = {}, comDpa = true) {
    const { tenant, nutri } = await nutriComTenant();
    if (comDpa) await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    const r = await recepcaoComLogin(db, getAuth(), tenant.id, o);
    req.headers = new Headers({ cookie: r.cookie, 'x-forwarded-for': '203.0.113.30' });
    return { tenant, nutri, recepcao: r };
  }
  const api = (cookie: string) =>
    new Request('http://localhost:3000/api/painel/relatorios/csv', { headers: { cookie, 'x-forwarded-for': '203.0.113.31' } });

  it('requireNutri com a recepção → Sem permissão (?motivo=nutri), nunca o aviso de outro papel; requireApiNutri → 403', async () => {
    const { recepcao } = await consultorioComRecepcao();
    await expect(requireNutri('/painel/pacientes/x/antropometria')).rejects.toMatchObject({ url: '/painel/sem-permissao?motivo=nutri' });
    const r = await requireApiNutri(api(recepcao.cookie));
    expect(r.ok ? 'ok' : [r.motivo, r.response.status]).toEqual(['papel', 403]);
  });

  it('requireEquipe com a recepção ativa: papel, permissão e o contexto `recepcao` com ator e IP', async () => {
    const { tenant, recepcao } = await consultorioComRecepcao();
    const r = await requireEquipe('/painel');
    expect([r.papel, r.financeiro, r.tenant.id]).toEqual(['recepcao', false, tenant.id]);
    expect(r.ctx).toEqual({ tenantId: tenant.id, role: 'recepcao', actorUserId: recepcao.id, ip: '203.0.113.30' });
  });

  it('requireEquipe com a nutricionista: papel nutri, Financeiro sempre; o DPA pendente continua indo a /painel/dpa', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await expect(requireEquipe('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    const r = await requireEquipe('/painel', { financeiro: true, secao: 'ranking' });
    expect([r.papel, r.financeiro, r.ctx.role, r.ctx.actorUserId]).toEqual(['nutri', true, 'nutri', nutri.id]);
  });

  it('desativada → /conta/acesso-desativado (também em requireNutri); API → 403', async () => {
    const { recepcao } = await consultorioComRecepcao({ desativada: true });
    await expect(requireEquipe('/painel')).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    await expect(requireNutri('/painel/pacientes')).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
    const r = await requireApiEquipe(api(recepcao.cookie));
    expect(r.ok ? 'ok' : [r.motivo, r.response.status]).toEqual(['papel', 403]);
  });

  it('DPA do consultório pendente → /painel/contrato-pendente (a recepção não aceita o DPA, RE-D29); com permitirDpaPendente, entra', async () => {
    const { tenant, recepcao } = await consultorioComRecepcao({}, false);
    await expect(requireEquipe('/painel')).rejects.toMatchObject({ url: '/painel/contrato-pendente' });
    await expect(requireEquipe('/painel', { permitirDpaPendente: true })).resolves.toMatchObject({ papel: 'recepcao', tenant: { id: tenant.id } });
    const r = await requireApiEquipe(api(recepcao.cookie));
    expect(r.ok ? 'ok' : [r.motivo, r.response.status]).toEqual(['dpa_pendente', 403]);
  });

  it('sem a permissão do Financeiro: { financeiro: true } → ?motivo=financeiro; com ela, entra (vale na próxima requisição, RN-502)', async () => {
    const { tenant, recepcao } = await consultorioComRecepcao();
    await expect(requireEquipe('/painel/financeiro', { financeiro: true })).rejects.toMatchObject({ url: '/painel/sem-permissao?motivo=financeiro' });
    const sem = await requireApiEquipe(api(recepcao.cookie), { financeiro: true });
    expect(sem.ok ? 'ok' : [sem.motivo, sem.response.status]).toEqual(['sem_permissao', 403]);
    await permissaoDoFinanceiro(db, tenant.id, recepcao.id, true);
    await expect(requireEquipe('/painel/financeiro', { financeiro: true })).resolves.toMatchObject({ papel: 'recepcao', financeiro: true });
    const com = await requireApiEquipe(api(recepcao.cookie), { financeiro: true });
    expect(com.ok ? [com.papel, com.financeiro, com.ctx.role, com.ctx.ip] : com.motivo).toEqual(['recepcao', true, 'recepcao', '203.0.113.31']);
  });

  it('seção dos Relatórios (RN-480): Atendimentos e Ranking → ?motivo=nutri; Financeiro sem a permissão → ?motivo=financeiro; Agenda entra', async () => {
    await consultorioComRecepcao();
    await expect(requireEquipe('/painel/relatorios/ranking', { secao: 'ranking' })).rejects.toMatchObject({ url: '/painel/sem-permissao?motivo=nutri' });
    await expect(requireEquipe('/painel/relatorios/atendimentos', { secao: 'atendimentos' })).rejects.toMatchObject({ url: '/painel/sem-permissao?motivo=nutri' });
    await expect(requireEquipe('/painel/relatorios/financeiro', { secao: 'financeiro' })).rejects.toMatchObject({ url: '/painel/sem-permissao?motivo=financeiro' });
    await expect(requireEquipe('/painel/relatorios/agenda', { secao: 'agenda' })).resolves.toMatchObject({ papel: 'recepcao' });
  });

  it('sem 2FA → Segurança da conta (RE-D20), antes de qualquer tela do painel', async () => {
    await consultorioComRecepcao({ twoFactorEnabled: false });
    await expect(requireEquipe('/painel')).rejects.toMatchObject({ url: '/conta/seguranca' });
  });

  it('a linha de equipe_membros é lida uma vez por requisição (com a sessão), e nunca para a nutricionista', async () => {
    await consultorioComRecepcao();
    vi.mocked(membroDaEquipe.lerMembroDaEquipe).mockClear();
    await requireEquipe('/painel', { financeiro: false, secao: 'agenda' });
    expect(membroDaEquipe.lerMembroDaEquipe).toHaveBeenCalledTimes(1);
    const { tenant, nutri } = await nutriComTenant();
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    vi.mocked(membroDaEquipe.lerMembroDaEquipe).mockClear();
    await requireEquipe('/painel');
    expect(membroDaEquipe.lerMembroDaEquipe).not.toHaveBeenCalled();
  });

  it('requireApiEquipe: sem sessão → 401; paciente e admin → 403', async () => {
    const r = await requireApiEquipe(new Request('http://localhost:3000/api/painel/relatorios/csv'));
    expect(r.ok ? 'ok' : [r.motivo, r.response.status]).toEqual(['sem_sessao', 401]);
    const { email } = await pacienteComConta(db, await novoTenant(db));
    const p = await requireApiEquipe(api(await entrar(getAuth(), email)));
    expect(p.ok ? 'ok' : [p.motivo, p.response.status]).toEqual(['papel', 403]);
  });
});
