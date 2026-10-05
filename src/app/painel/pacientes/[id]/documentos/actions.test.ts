import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { documentoNoBanco } from '../../../../../../test/documentos';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../test/pacientes';

// As ações pelo caminho real (requireNutri → Postgres via Testcontainers), como plano-alimentar/actions.test.ts; só o
// que depende do runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
const req = vi.hoisted(() => ({ headers: new Headers() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());
const MUDOU = { erros: { geral: 'Este documento mudou de situação. Recarregue a página.' } };

async function consultorio() {
  const N = await nutriComDpa(db, auth);
  await db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, N.tenantId));
  req.headers = new Headers({ cookie: N.cookie });
  const p = await novoPaciente(db, N.ctx);
  return { N, p };
}

describe('ações do documento: o erro volta ao formulário; o sinal de sucesso só quando deu certo', () => {
  it('"Apagar rascunho" de um documento que outra aba já preparou: o motivo, sem "Rascunho apagado." nem revalidar', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' });
    expect(await apagarRascunhoAction(p.id, preparando.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    await expect(apagarRascunhoAction(p.id, rascunho.id, {})).rejects.toThrow(`redirect /painel/pacientes/${p.id}/documentos?apagado=1`);
  });

  it('"Gerar o PDF de novo" e "Voltar a editar" fora do estado: o motivo, sem revalidar; no estado certo, ok', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' }); // pdf_status nulo: nada a pedir de novo
    expect(await pedirNovoPdfAction(p.id, preparando.id, {})).toEqual(MUDOU);
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await voltarAEditarAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await voltarAEditarAction(p.id, preparando.id, {})).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
  });
});
