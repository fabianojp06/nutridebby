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

// Plano 15: a pausa é UMA linha para o banco inteiro, e os arquivos de teste rodam em paralelo — aqui o módulo é simulado
// (o "Pausar"/"Retomar" de verdade é testado no cluster próprio de ia-nutri-pausa.test.ts, T5)
const pausa = vi.hoisted(() => ({ pausar: vi.fn(), retomar: vi.fn() }));
vi.mock('@/modules/plataforma/ia-nutri-pausa', async (orig) => ({ ...(await orig<typeof import('@/modules/plataforma/ia-nutri-pausa')>()), pausarIaNutri: pausa.pausar, retomarIaNutri: pausa.retomar }));

const { ajustarCotaAction, ajustarCotaIaNutriAction, definirDocumentosAction, definirIaAction, pausarIaNutriAction, reativarAction, reenviarConviteAction, retomarIaNutriAction, suspenderAction } = await import('./actions');
const { CONFIRMAR_PAUSAR_IA_NUTRI, CONFIRMAR_RETOMAR_IA_NUTRI } = await import('./textos');

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

  it('A-D27: com os textos 1.0, a IA é liberada em produção (sem o aviso "ia_provisoria")', async () => {
    const id = await consultorio();
    ambiente.producao = true;
    try {
      expect(await destino(definirIaAction(id, true))).toBeNull();
      const [t] = await db.select({ ia: tenants.iaLiberada }).from(tenants).where(eq(tenants.id, id));
      expect(t.ia).toBe(true);
    } finally {
      ambiente.producao = null;
    }
  });
});

describe('Plano 15: a IA Nutri no admin (RN-185, DP-1, D3, ★ DO-1 = não, ★ DO-5)', () => {
  it('"Pausar" é o desligamento de emergência; "Retomar" fala do motivo da pausa e não lista condição do runbook', () => {
    expect(CONFIRMAR_PAUSAR_IA_NUTRI).toContain('emergência');
    expect(CONFIRMAR_RETOMAR_IA_NUTRI).toContain('motivo da pausa');
    for (const c of ['CRN-3', 'advogado', 'RIPD', '12/11/2026', 'provisorio', 'provisório', 'avaliação', 'runbook'])
      expect(CONFIRMAR_RETOMAR_IA_NUTRI.toLowerCase(), c).not.toContain(c.toLowerCase());
  });

  it('pausar e retomar gravam em nome da admin da sessão e revalidam o layout do /admin', async () => {
    expect(await destino(pausarIaNutriAction())).toBeNull();
    expect(await destino(retomarIaNutriAction())).toBeNull();
    const [admin] = pausa.pausar.mock.calls[0] as [string];
    expect(admin).toMatch(/^[0-9a-f-]{36}$/);
    expect(pausa.retomar).toHaveBeenCalledWith(admin);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/admin', 'layout'], ['/admin', 'layout']]);
  });

  it('"Limite da IA Nutri (US$/mês)": grava a cota própria; valor inválido, conta inválida ou inexistente → erro na tela', async () => {
    const id = await consultorio();
    const fd = (v: string) => {
      const f = new FormData();
      f.set('cotaIaNutri', v);
      return f;
    };
    expect(await ajustarCotaIaNutriAction(id, {}, fd('9,50'))).toEqual({ ok: true });
    const [t] = await db.select({ c: tenants.iaNutriCotaMensalUsd, nutri: tenants.iaCotaMensalUsd }).from(tenants).where(eq(tenants.id, id));
    expect(t).toEqual({ c: 9.5, nutri: 15 });
    expect((await ajustarCotaIaNutriAction(id, {}, fd('abc'))).erro).toBeTruthy();
    expect(await ajustarCotaIaNutriAction('x', {}, fd('1'))).toEqual({ erro: 'Conta inválida' });
    expect((await ajustarCotaIaNutriAction(randomUUID(), {}, fd('1'))).erro).toBeTruthy();
  });
});
