import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { novoTenant } from '../../../../test/pacientes';
import { pacienteComConta } from '../../../../test/portal';
import { entrar } from '../../../../test/sessao';

// D3: escolherAction pelo caminho real (requireUser → Postgres via Testcontainers); só o runtime do Next é simulado.
const req = vi.hoisted(() => ({ headers: new Headers(), gravados: [] as { nome: string; valor: string; o: Record<string, unknown> }[] }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    set: (nome: string, valor: string, o: Record<string, unknown>) => req.gravados.push({ nome, valor, o }),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));

const { escolherAction } = await import('./actions');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
  req.gravados = [];
});

async function contaComDoisVinculos() {
  const A = await novoTenant(db, 'Debby');
  const B = await novoTenant(db, 'Bia');
  const a = await pacienteComConta(db, A);
  const b = await pacienteComConta(db, B, { userId: a.userId });
  req.headers = new Headers({ cookie: await entrar(getAuth(), a.email) });
  return { A, B, b };
}

describe('escolherAction (D3)', () => {
  it('grava o cookie do vínculo (30 dias, httpOnly, Lax) e volta para a página do portal pedida', async () => {
    const { B } = await contaComDoisVinculos();
    await expect(escolherAction(B.tenantId, '/p/plano?dia=2')).rejects.toMatchObject({ url: '/p/plano?dia=2' });
    expect(req.gravados).toEqual([
      { nome: 'nd_vinculo', valor: B.tenantId, o: { path: '/', maxAge: 2592000, httpOnly: true, sameSite: 'lax', secure: expect.any(Boolean) } },
    ]);
  });

  it('volta de fora do portal, externa ou para a própria escolha → /p/inicio', async () => {
    const { A } = await contaComDoisVinculos();
    for (const volta of ['/painel', '//evil.com/p/x', 'https://evil.com/p/x', '/p/escolher?volta=%2Fp%2Fplano']) {
      await expect(escolherAction(A.tenantId, volta), volta).rejects.toMatchObject({ url: '/p/inicio' });
    }
  });

  it('tenant que não é vínculo ativo da conta (forjado ou arquivado) → de volta à escolha, sem cookie', async () => {
    const { B, b } = await contaComDoisVinculos();
    await expect(escolherAction(randomUUID(), '/p/inicio')).rejects.toMatchObject({ url: '/p/escolher' });
    await withTenant(B.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, b.paciente.id)), db);
    await expect(escolherAction(B.tenantId, '/p/inicio')).rejects.toMatchObject({ url: '/p/escolher' });
    expect(req.gravados).toEqual([]);
  });

  it('consultório suspenso (RN-15) → de volta à escolha, sem cookie', async () => {
    const { A } = await contaComDoisVinculos();
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    await expect(escolherAction(A.tenantId, '/p/inicio')).rejects.toMatchObject({ url: '/p/escolher' });
    expect(req.gravados).toEqual([]);
  });
});
