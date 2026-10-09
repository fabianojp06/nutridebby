import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarEEntrar } from '../../../test/sessao';

// P16-17: as ações por conta voltam para a página da conta; conta que não existe (ou id que não é uuid) volta para a lista
// com o aviso. Caminho real (requireUser → Postgres via Testcontainers); só o runtime do Next é simulado.
const req = vi.hoisted(() => ({ headers: new Headers() }));
const ambiente = vi.hoisted(() => ({ producao: null as boolean | null }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('@/env', async (orig) => {
  const real = await orig<typeof import('@/env')>();
  return { ...real, emProducao: (e: Parameters<typeof real.emProducao>[0]) => ambiente.producao ?? real.emProducao(e) };
});

const { ajustarCotaAction, definirDocumentosAction, definirIaAction, reativarAction, reenviarConviteAction, suspenderAction } = await import('./actions');

const db = getDb();
afterAll(() => closeDb());
beforeAll(async () => {
  const a = await criarEEntrar(db, getAuth(), { appRole: 'admin', twoFactorEnabled: true });
  req.headers = new Headers({ cookie: a.cookie });
});
beforeEach(() => vi.mocked(revalidatePath).mockClear());

async function consultorio() {
  const [t] = await db.insert(tenants).values({ slug: `adm-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Admin teste' }).returning({ id: tenants.id });
  return t.id;
}
const destino = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe('P16-17: destino das ações do admin', () => {
  it('suspender e reativar voltam para a página da conta com o aviso', async () => {
    const id = await consultorio();
    expect(await destino(suspenderAction(id))).toBe(`redirect /admin/contas/${id}?aviso=suspensa`);
    expect(await destino(reativarAction(id))).toBe(`redirect /admin/contas/${id}?aviso=reativada`);
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
  });

  it('reenviar convite volta para a página da conta com o aviso do resultado', async () => {
    const id = await consultorio(); // sem nutricionista
    expect(await destino(reenviarConviteAction(id))).toBe(`redirect /admin/contas/${id}?aviso=sem_nutri`);
  });

  it('id que não é uuid ou conta que não existe → lista com "nao_encontrada"', async () => {
    for (const id of ['x', randomUUID()]) {
      expect(await destino(suspenderAction(id))).toBe('redirect /admin?aviso=nao_encontrada');
      expect(await destino(reativarAction(id))).toBe('redirect /admin?aviso=nao_encontrada');
      expect(await destino(definirDocumentosAction(id, true))).toBe('redirect /admin?aviso=nao_encontrada');
      expect(await destino(definirIaAction(id, false))).toBe('redirect /admin?aviso=nao_encontrada');
    }
    expect(await destino(reenviarConviteAction('x'))).toBe('redirect /admin?aviso=nao_encontrada');
  });

  it('documentos e IA ficam na página (sem redirect) e revalidam o layout do /admin (lista e página da conta)', async () => {
    const id = await consultorio();
    expect(await destino(definirDocumentosAction(id, true))).toBeNull();
    expect(await destino(definirIaAction(id, true))).toBeNull();
    const [t] = await db.select({ d: tenants.documentosLiberados, ia: tenants.iaLiberada }).from(tenants).where(eq(tenants.id, id));
    expect(t).toEqual({ d: true, ia: true });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin', 'layout'], ['/admin', 'layout']]);
    const fd = new FormData();
    fd.set('cota', '300');
    expect(await ajustarCotaAction(id, {}, fd)).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenLastCalledWith('/admin', 'layout');
  });

  it('IA com textos provisórios em produção volta para a página da conta com "ia_provisoria"', async () => {
    const id = await consultorio();
    ambiente.producao = true;
    try {
      expect(await destino(definirIaAction(id, true))).toBe(`redirect /admin/contas/${id}?aviso=ia_provisoria`);
    } finally {
      ambiente.producao = null;
    }
  });
});
