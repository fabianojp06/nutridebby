import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { consents, tenants } from '@/db/schema';
import { novoTenant } from '../../test/pacientes';
import { pacienteComConta } from '../../test/portal';
import { entrar } from '../../test/sessao';
import { getAuth } from './auth';

// P08-13 (S-7): no Vitest o `cache` do React só repassa a chamada (build de cliente); aqui ele ganha o escopo de uma
// requisição — um mapa por função, argumentos comparados por identidade como no React (Map usa SameValueZero), zerado a
// cada `requisicao()` e desligado fora dela (Server Action, Route Handler: o React não guarda nada).
const escopo = vi.hoisted(() => ({ mapas: null as Map<unknown, Map<unknown, unknown>> | null }));
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>();
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...args: A): R => {
      if (!escopo.mapas) return fn(...args);
      let no = escopo.mapas.get(fn);
      if (!no) escopo.mapas.set(fn, (no = new Map()));
      for (const a of args) {
        let prox = no.get(a) as Map<unknown, unknown> | undefined;
        if (!prox) no.set(a, (prox = new Map()));
        no = prox;
      }
      if (!no.has(escopo)) no.set(escopo, fn(...args));
      return no.get(escopo) as R;
    };
  return { ...real, cache };
});
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
vi.mock('@/modules/portal/vinculos', async (orig) => {
  const real = await orig<typeof import('@/modules/portal/vinculos')>();
  return { ...real, vinculosComConsultorio: vi.fn(real.vinculosComConsultorio) };
});
vi.mock('@/modules/portal/termo', async (orig) => {
  const real = await orig<typeof import('@/modules/portal/termo')>();
  return { ...real, termoAceito: vi.fn(real.termoAceito) };
});
vi.mock('@/modules/plataforma/tenant-status', async (orig) => {
  const real = await orig<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, buscarTenant: vi.fn(real.buscarTenant) };
});

const { requireApiPaciente, requirePaciente, TERMO_PATH } = await import('./paciente-session');
const { vinculosComConsultorio } = await import('@/modules/portal/vinculos');
const { termoAceito } = await import('@/modules/portal/termo');
const { buscarTenant } = await import('@/modules/plataforma/tenant-status');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
  vi.mocked(vinculosComConsultorio).mockClear();
  vi.mocked(termoAceito).mockClear();
  vi.mocked(buscarTenant).mockClear();
});

async function requisicao<T>(fn: () => Promise<T>): Promise<T> {
  escopo.mapas = new Map();
  try {
    return await fn();
  } finally {
    escopo.mapas = null;
  }
}

async function logado(vinculos = 1, o: { semTermo?: boolean } = {}) {
  const A = await novoTenant(db, 'Debby');
  const { userId, paciente, email } = await pacienteComConta(db, A, { semTermo: o.semTermo });
  const outros = [];
  for (let i = 1; i < vinculos; i++) {
    const T = await novoTenant(db, `Nutri ${i}`);
    outros.push({ T, ...(await pacienteComConta(db, T, { userId })) });
  }
  const cookie = await entrar(getAuth(), email);
  req.headers = new Headers({ cookie, 'x-forwarded-for': '203.0.113.31' });
  return { A, userId, paciente, outros, cookie };
}

describe('requirePaciente: a regra do portal uma vez por requisição (P08-13, S-7)', () => {
  it('layout e página na mesma requisição: uma leitura dos vínculos e do termo, o mesmo contexto; sem reler tenants', async () => {
    const { A, userId, paciente } = await logado();
    const [layout, pagina] = await requisicao(() => Promise.all([requirePaciente('/p/inicio'), requirePaciente('/p/plano')]));
    expect(vinculosComConsultorio).toHaveBeenCalledTimes(1);
    expect(termoAceito).toHaveBeenCalledTimes(1);
    expect(buscarTenant).not.toHaveBeenCalled();
    expect(pagina.ctx).toEqual({ tenantId: A.tenantId, role: 'paciente', patientId: paciente.id, actorUserId: userId, ip: '203.0.113.31' });
    expect(layout.ctx).toEqual(pagina.ctx);
    // a linha inteira do consultório, igual à de `tenants`
    const [linha] = await db.select().from(tenants).where(eq(tenants.id, A.tenantId));
    expect(pagina.tenant).toEqual(linha);
  });

  it('o redirect não é guardado: cada chamada monta o `volta` com o próprio path, com uma leitura só', async () => {
    await logado(2);
    await requisicao(async () => {
      await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Finicio' });
      await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
    });
    expect(vinculosComConsultorio).toHaveBeenCalledTimes(1);
  });

  it('a chave leva `exigirTermo`: com o termo pendente, o portal vai ao termo e a própria tela do termo entra na mesma requisição', async () => {
    const { A } = await logado(1, { semTermo: true });
    await requisicao(async () => {
      await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: TERMO_PATH });
      expect((await requirePaciente(TERMO_PATH, { permitirTermoPendente: true })).tenant.id).toBe(A.tenantId);
    });
    expect(vinculosComConsultorio).toHaveBeenCalledTimes(2);
  });

  it('nada passa de uma requisição para a outra: o aceite e a suspensão valem na seguinte; contas diferentes, contextos próprios', async () => {
    const { A, userId } = await logado(1, { semTermo: true });
    await requisicao(() => expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: TERMO_PATH }));
    await db.insert(consents).values({ userId, tenantId: A.tenantId, termoVersao: (await import('@/modules/pacientes/termo-paciente')).TERMO_PACIENTE, ip: null });
    expect((await requisicao(() => requirePaciente('/p/inicio'))).tenant.id).toBe(A.tenantId);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    await requisicao(() => expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/indisponivel' }));
    const B = await logado();
    const r = await requisicao(() => requirePaciente('/p/inicio'));
    expect(r.ctx).toMatchObject({ tenantId: B.A.tenantId, patientId: B.paciente.id, actorUserId: B.userId });
  });

  it('fora de uma requisição (Server Action) e na API: cada chamada relê', async () => {
    const { cookie } = await logado();
    await requirePaciente('/p/inicio');
    await requirePaciente('/p/plano');
    expect(vinculosComConsultorio).toHaveBeenCalledTimes(2);
    await requisicao(async () => {
      for (let i = 0; i < 2; i++) expect((await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie } }))).ok).toBe(true);
    });
    expect(vinculosComConsultorio).toHaveBeenCalledTimes(4);
  });

  it('`vinculos` sai sem a linha dos consultórios: só tenantId, patientId, nomeNutri e tenantStatus', async () => {
    const { outros, cookie } = await logado(2);
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${outros[0].T.tenantId}` });
    const r = await requisicao(() => requirePaciente('/p/perfil'));
    expect(r.vinculos).toHaveLength(2);
    for (const v of r.vinculos) expect(Object.keys(v).sort()).toEqual(['nomeNutri', 'patientId', 'tenantId', 'tenantStatus']);
    expect(r.tenant.id).toBe(outros[0].T.tenantId);
  });
});
