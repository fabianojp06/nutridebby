import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { MSG_LISTAS } from '@/modules/plano-alimentar/biblioteca-constantes';
import { carregarLista, listarListas } from '@/modules/plano-alimentar/listas';
import { nutriComDpa } from '../../../../../test/nutri';

// As actions pelo caminho real (requireNutri → Postgres via Testcontainers), como em referencias/actions.test.ts;
// só o que depende do runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
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

const { excluirListaAction, salvarListaAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());

async function nutri() {
  const N = await nutriComDpa(db, auth);
  req.headers = new Headers({ cookie: N.cookie });
  return N;
}
const TROCAS = () => ({
  nome: 'Trocas do dia a dia',
  orientacao: '',
  grupos: [{ id: randomUUID(), nome: 'Carboidratos — 1 porção', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '120', medida: null }] }],
});
const formulario = (dados: unknown) => {
  const fd = new FormData();
  fd.set('dados', typeof dados === 'string' ? dados : JSON.stringify(dados));
  return fd;
};
const redirecionouPara = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  const m = e instanceof Error ? /^redirect (.+)$/.exec(e.message) : null;
  if (!m) throw e ?? new Error('esperava redirect');
  return m[1];
};

describe('salvarListaAction (US-238)', () => {
  it('"Nova lista" (id nulo): cria e vai para a página da lista criada; a lista é revalidada', async () => {
    const N = await nutri();
    const url = await redirecionouPara(salvarListaAction(null, {}, formulario(TROCAS())));
    const [lista] = await listarListas(N.ctx, db);
    expect(url).toBe(`/painel/planos/listas/${lista.id}`);
    expect(lista).toMatchObject({ nome: 'Trocas do dia a dia', grupos: 1, itens: 1 });
    expect(revalidatePath).toHaveBeenCalledWith('/painel/planos/listas');
  });

  it('erros por campo e o 21º grupo voltam ao formulário; JSON quebrado não vira 500; nada é gravado', async () => {
    const N = await nutri();
    expect(await salvarListaAction(null, {}, formulario({ ...TROCAS(), nome: '' }))).toEqual({ erros: { nome: MSG_LISTAS.nome } });
    const grupos = Array.from({ length: 21 }, (_, k) => ({ ...TROCAS().grupos[0], id: randomUUID(), nome: `G${k}` }));
    expect(await salvarListaAction(null, {}, formulario({ ...TROCAS(), grupos }))).toEqual({ erros: { geral: 'A lista pode ter até 20 grupos e 30 itens por grupo.' } });
    expect((await salvarListaAction(null, {}, formulario('{quebrado'))).erros?.geral).toBeTruthy();
    expect(await listarListas(N.ctx, db)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('alterar fica na página com "Lista salva."; excluir volta às listas; de outro consultório → "Lista não encontrada."', async () => {
    const N = await nutri();
    await redirecionouPara(salvarListaAction(null, {}, formulario(TROCAS())));
    const [{ id }] = await listarListas(N.ctx, db);
    expect(await salvarListaAction(id, {}, formulario({ ...TROCAS(), orientacao: 'Troque dentro do grupo.' }))).toEqual({ ok: MSG_LISTAS.salva });
    expect((await carregarLista(N.ctx, id, db))!.orientacao).toBe('Troque dentro do grupo.');
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/planos/listas/${id}`);

    await nutri();
    expect(await excluirListaAction(id)).toEqual({ erros: { geral: MSG_LISTAS.naoEncontrada } });
    req.headers = new Headers({ cookie: N.cookie });
    expect(await redirecionouPara(excluirListaAction(id))).toBe('/painel/planos/listas');
    expect(await listarListas(N.ctx, db)).toEqual([]);
  });
});
