import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { consents, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
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
vi.mock('next/headers', () => ({
  headers: async () => req.headers,
  cookies: async () => {
    const pares = (req.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('='));
    return {
      get: (nome: string) => {
        const p = pares.find(([n]) => n === nome);
        return p ? { name: nome, value: p.slice(1).join('=') } : undefined;
      },
    };
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireApiPaciente, requirePaciente, cookieDoVinculo, cookieDoVinculoApagado, lerCookie, voltaDoPortal, voltaDoTermo } = await import('./paciente-session');
const { GET: trocarVinculo } = await import('@/app/api/p/vinculo/route');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function logado(vinculos = 1) {
  const A = await novoTenant(db, 'Debby');
  const { userId, paciente, email } = await pacienteComConta(db, A);
  const outros = [];
  for (let i = 1; i < vinculos; i++) {
    const T = await novoTenant(db, `Nutri ${i}`);
    outros.push({ T, ...(await pacienteComConta(db, T, { userId })) });
  }
  const cookie = await entrar(getAuth(), email);
  req.headers = new Headers({ cookie, 'x-forwarded-for': '203.0.113.30' });
  return { A, userId, paciente, outros, cookie };
}

describe('requirePaciente (D2, D3, RN-08, RN-15)', () => {
  it('um vínculo: entra com o contexto do paciente (tenant, paciente, ator, IP)', async () => {
    const { A, userId, paciente } = await logado();
    const r = await requirePaciente('/p/inicio');
    expect(r.ctx).toEqual({ tenantId: A.tenantId, role: 'paciente', patientId: paciente.id, actorUserId: userId, ip: '203.0.113.30' });
    expect(r.tenant.id).toBe(A.tenantId);
  });

  it('dois vínculos sem cookie → /p/escolher; com o cookie de um deles → entra nele; cookie forjado → /p/escolher', async () => {
    const { outros, cookie } = await logado(2);
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${outros[0].T.tenantId}` });
    expect((await requirePaciente('/p/plano')).ctx.patientId).toBe(outros[0].paciente.id);
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${randomUUID()}` });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
  });

  it('arquivado → /p/sem-acesso (RN-08); tenant suspenso → /indisponivel (RN-15)', async () => {
    const { A, paciente } = await logado();
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, paciente.id)), db);
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/p/sem-acesso' });
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, paciente.id)), db);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/indisponivel' });
  });

  it('dois vínculos e o cookie no consultório suspenso → /p/escolher (RN-15 barra só aquele); todos suspensos → /indisponivel', async () => {
    const { A, outros, cookie } = await logado(2);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${A.tenantId}` });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${outros[0].T.tenantId}` });
    expect((await requirePaciente('/p/plano')).ctx.patientId).toBe(outros[0].paciente.id);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, outros[0].T.tenantId));
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/indisponivel' });
    req.headers = new Headers({ cookie });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/indisponivel' });
  });

  it('termo da versão atual não aceito neste consultório → /p/termo (US-011 "Nova versão do termo"); a própria página do termo entra', async () => {
    const A = await novoTenant(db);
    const { email } = await pacienteComConta(db, A, { semTermo: true });
    req.headers = new Headers({ cookie: await entrar(getAuth(), email) });
    // S-1: o destino (link da exportação, push) vai junto em ?volta=, sem o ?v=; o Início não precisa de ?volta=
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/termo?volta=%2Fp%2Fplano' });
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/p/termo' });
    req.headers.set('x-nd-caminho', `/p/meus-dados/exportacoes/abc?v=${A.tenantId}`);
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/p/termo?volta=%2Fp%2Fmeus-dados%2Fexportacoes%2Fabc' });
    expect((await requirePaciente('/p/termo', { permitirTermoPendente: true })).tenant.id).toBe(A.tenantId);
  });

  it('P08-06: com só o aceite da 0.1 provisória, o portal leva ao termo 1.0 e a API dá 403', async () => {
    const A = await novoTenant(db);
    const { userId, email } = await pacienteComConta(db, A, { semTermo: true });
    await db.insert(consents).values({ userId, tenantId: A.tenantId, termoVersao: 'termo-paciente-0.1-provisorio', ip: null });
    const cookie = await entrar(getAuth(), email);
    req.headers = new Headers({ cookie });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/termo?volta=%2Fp%2Fplano' });
    const r = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie } }));
    expect(r.ok ? null : r.response.status).toBe(403);
  });

  it('nutricionista no portal vai ao aviso de outro papel (P09-03); sem sessão vai para o login', async () => {
    const [t] = await db.insert(tenants).values({ slug: `ps-${randomUUID().slice(0, 8)}`, nomeExibicao: 'X' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    req.headers = new Headers({ cookie: n.cookie });
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/conta/outro-papel?esperado=paciente' });
    req.headers = new Headers();
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/entrar?volta=%2Fp%2Finicio' });
  });
});

describe('requireApiPaciente', () => {
  it('401 sem sessão, 403 para outro papel e para sem vínculo/escolha, ok com o contexto', async () => {
    const sem = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST' }));
    expect(sem.ok ? 200 : sem.response.status).toBe(401);
    const [t] = await db.insert(tenants).values({ slug: `ps-${randomUUID().slice(0, 8)}`, nomeExibicao: 'X' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    const nutri = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: n.cookie } }));
    expect(nutri.ok ? 200 : nutri.response.status).toBe(403);
    const { A, paciente, cookie } = await logado();
    const r = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie } }));
    expect(r.ok && r.ctx).toMatchObject({ tenantId: A.tenantId, patientId: paciente.id, role: 'paciente' });
    const dois = await logado(2);
    const semEscolha = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: dois.cookie } }));
    expect(semEscolha.ok ? 200 : semEscolha.response.status).toBe(403);
    const comEscolha = await requireApiPaciente(
      new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: `${dois.cookie}; nd_vinculo=${dois.outros[0].T.tenantId}` } }),
    );
    expect(comEscolha.ok && comEscolha.ctx.patientId).toBe(dois.outros[0].paciente.id);
  });

  it('termo pendente → 403 com a mensagem do termo; consultório suspenso → 403', async () => {
    const A = await novoTenant(db);
    const { email } = await pacienteComConta(db, A, { semTermo: true });
    const cookie = await entrar(getAuth(), email);
    const r = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie } }));
    expect(r.ok ? null : [r.response.status, await r.response.json()]).toEqual([403, { erro: 'Para continuar, aceite o Termo de Uso e Privacidade.' }]);
    const B = await logado();
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, B.A.tenantId));
    const s = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: B.cookie } }));
    expect(s.ok ? null : [s.response.status, await s.response.json()]).toEqual([403, { erro: 'Conta temporariamente indisponível' }]);
  });

  it('API com dois vínculos: cookie no suspenso → 403 "Acesso negado" (escolher); todos suspensos → 403 "Conta temporariamente indisponível"', async () => {
    const { A, outros, cookie } = await logado(2);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    const pedir = async (c: string) => {
      const r = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: c } }));
      return r.ok ? r.ctx.patientId : [r.response.status, await r.response.json()];
    };
    // S-4: o motivo vai junto, para a tela oferecer o link da escolha
    expect(await pedir(`${cookie}; nd_vinculo=${A.tenantId}`)).toEqual([403, { erro: 'Acesso negado', motivo: 'escolher' }]);
    expect(await pedir(cookie)).toEqual([403, { erro: 'Acesso negado', motivo: 'escolher' }]);
    expect(await pedir(`${cookie}; nd_vinculo=${outros[0].T.tenantId}`)).toBe(outros[0].paciente.id);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, outros[0].T.tenantId));
    expect(await pedir(`${cookie}; nd_vinculo=${outros[0].T.tenantId}`)).toEqual([403, { erro: 'Conta temporariamente indisponível' }]);
  });

  it('cookieDoVinculo: httpOnly, SameSite=Lax, 30 dias, Secure só em produção; cookieDoVinculoApagado (Sair) com os mesmos atributos; lerCookie acha o valor', () => {
    const id = randomUUID();
    expect(cookieDoVinculo(id, false)).toBe(`nd_vinculo=${id}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    expect(cookieDoVinculo(id, true)).toContain('; Secure');
    expect(cookieDoVinculoApagado(false)).toBe('nd_vinculo=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(cookieDoVinculoApagado(true)).toBe('nd_vinculo=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
    expect(lerCookie(`nd.session_token=abc=; nd_vinculo=${id}`, 'nd_vinculo')).toBe(id);
    expect(lerCookie('nd.session_token=abc', 'nd_vinculo')).toBeUndefined();
    expect(lerCookie(null, 'nd_vinculo')).toBeUndefined();
  });
});

describe('link com o consultório (?v=): e-mail e push abrem o vínculo certo com 2+ vínculos', () => {
  const naPagina = (cookie: string, caminho: string) => {
    req.headers = new Headers({ cookie, 'x-nd-caminho': caminho, 'x-forwarded-for': '203.0.113.30' });
  };

  it('página: vínculo ativo da conta diferente do cookie → regrava o nd_vinculo (rota) e volta sem o ?v=; igual ao cookie → entra nele', async () => {
    const { A, paciente, outros, cookie } = await logado(2);
    const B = outros[0].T.tenantId;
    naPagina(`${cookie}; nd_vinculo=${B}`, `/p/meus-dados/exportacoes/abc?v=${A.tenantId}`);
    await expect(requirePaciente('/p/meus-dados/exportacoes/abc')).rejects.toMatchObject({
      url: `/api/p/vinculo?v=${A.tenantId}&volta=%2Fp%2Fmeus-dados%2Fexportacoes%2Fabc`,
    });
    // sem cookie nenhum (aparelho novo, depois do login): também
    naPagina(cookie, `/p/plano?v=${A.tenantId}`);
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: `/api/p/vinculo?v=${A.tenantId}&volta=%2Fp%2Fplano` });
    // depois da rota (cookie já em A): entra em A, mesmo com o ?v= ainda na URL
    naPagina(`${cookie}; nd_vinculo=${A.tenantId}`, `/p/plano?v=${A.tenantId}`);
    expect((await requirePaciente('/p/plano')).ctx).toMatchObject({ tenantId: A.tenantId, patientId: paciente.id });
  });

  it('página: ?v= que não é vínculo ativo da conta (forjado, de outra conta, suspenso) é ignorado e segue o fluxo normal', async () => {
    const { A, outros, cookie } = await logado(2);
    const B = outros[0].T.tenantId;
    const estranho = await novoTenant(db, 'Outra');
    naPagina(`${cookie}; nd_vinculo=${B}`, `/p/plano?v=${estranho.tenantId}`);
    expect((await requirePaciente('/p/plano')).ctx.patientId).toBe(outros[0].paciente.id);
    naPagina(cookie, `/p/plano?v=${randomUUID()}`);
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' }); // sem o ?v= na volta
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    naPagina(`${cookie}; nd_vinculo=${B}`, `/p/plano?v=${A.tenantId}`);
    expect((await requirePaciente('/p/plano')).ctx.patientId).toBe(outros[0].paciente.id);
  });

  it('página: com um vínculo só, o ?v= de outro consultório não muda nada (entra no único)', async () => {
    const { A, cookie } = await logado();
    const outro = await novoTenant(db, 'Outra');
    naPagina(cookie, `/p/plano?v=${outro.tenantId}`);
    expect((await requirePaciente('/p/plano')).tenant.id).toBe(A.tenantId);
  });

  it('API: o ?v= da URL vale como na página (vínculo ativo da conta); forjado fica com o cookie', async () => {
    const { A, paciente, outros, cookie } = await logado(2);
    const B = outros[0].T.tenantId;
    const pedir = async (q: string) => {
      const r = await requireApiPaciente(new Request(`http://x/api/p/acesso${q}`, { method: 'POST', headers: { cookie: `${cookie}; nd_vinculo=${B}` } }));
      return r.ok ? r.ctx.patientId : r.response.status;
    };
    expect(await pedir(`?v=${A.tenantId}`)).toBe(paciente.id);
    expect(await pedir(`?v=${randomUUID()}`)).toBe(outros[0].paciente.id);
    expect(await pedir('')).toBe(outros[0].paciente.id);
  });

  it('GET /api/p/vinculo confere de novo: só grava o nd_vinculo de vínculo ativo da conta; volta sempre para o portal, sem o ?v=', async () => {
    const { A, outros, cookie } = await logado(2);
    const estranho = await novoTenant(db, 'Outra');
    const trocar = (q: string, c: string | null = cookie) => trocarVinculo(new Request(`http://x/api/p/vinculo${q}`, { headers: c ? { cookie: c } : {} }));
    const ok = await trocar(`?v=${A.tenantId}&volta=${encodeURIComponent('/p/plano?pdf=preparando&v=x')}`);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/p/plano?pdf=preparando');
    expect(ok.headers.get('set-cookie')).toBe(cookieDoVinculo(A.tenantId, false));
    expect(ok.headers.get('cache-control')).toBe('no-store');
    // vínculo de outra conta, forjado ou suspenso: nada de cookie
    for (const v of [estranho.tenantId, randomUUID(), 'lixo']) expect((await trocar(`?v=${v}&volta=%2Fp%2Fplano`)).headers.get('set-cookie'), v).toBeNull();
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, outros[0].T.tenantId));
    expect((await trocar(`?v=${outros[0].T.tenantId}&volta=%2Fp%2Fplano`)).headers.get('set-cookie')).toBeNull();
    // sem sessão: só volta (a página manda ao login)
    const sem = await trocar(`?v=${A.tenantId}&volta=%2Fp%2Fplano`, null);
    expect([sem.status, sem.headers.get('location'), sem.headers.get('set-cookie')]).toEqual([303, '/p/plano', null]);
    // volta insegura ou fora do portal → Início
    for (const volta of ['//evil.example/p/x', 'https://evil.example', '/painel', '/p/escolher?volta=%2Fp%2Fplano'])
      expect((await trocar(`?v=${A.tenantId}&volta=${encodeURIComponent(volta)}`)).headers.get('location'), volta).toBe('/p/inicio');
  });

  it('voltaDoPortal: só /p/ (fora a escolha), sem o ?v=, mantendo o resto da query', () => {
    expect(voltaDoPortal('/p/agenda?semana=2&v=abc')).toBe('/p/agenda?semana=2');
    expect(voltaDoPortal('/p/plano?v=a&v=b')).toBe('/p/plano');
    expect(voltaDoPortal('/p/escolher')).toBe('/p/inicio');
    expect(voltaDoPortal('/entrar')).toBe('/p/inicio');
    expect(voltaDoPortal(null)).toBe('/p/inicio');
    expect(voltaDoPortal('/p/%2e%2e//evil.example')).toBe('/p/inicio');
  });

  it('voltaDoTermo (S-1): a regra do voltaDoPortal, e nunca a própria tela do termo', () => {
    expect(voltaDoTermo('/p/meus-dados/exportacoes/abc?v=x')).toBe('/p/meus-dados/exportacoes/abc');
    expect(voltaDoTermo('/p/termo')).toBe('/p/inicio');
    expect(voltaDoTermo('/p/termo?volta=%2Fp%2Fplano')).toBe('/p/inicio');
    expect(voltaDoTermo('/p/escolher')).toBe('/p/inicio');
    expect(voltaDoTermo('https://evil.example')).toBe('/p/inicio');
    expect(voltaDoTermo(undefined)).toBe('/p/inicio');
  });
});

