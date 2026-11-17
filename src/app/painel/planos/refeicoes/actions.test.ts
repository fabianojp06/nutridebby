import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { MSG_MINHAS_REFEICOES } from '@/modules/plano-alimentar/biblioteca-constantes';
import { carregarMinhaRefeicao, listarMinhasRefeicoes } from '@/modules/plano-alimentar/refeicoes-modelo';
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

const { alterarMinhaRefeicaoAction, carregarMinhaRefeicaoAction, excluirMinhaRefeicaoAction, salvarComoMinhaRefeicaoAction } = await import('./actions');

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
const almoco = (incluirObservacao?: boolean) => ({
  nome: 'Almoço leve', tipo: 'Almoço', horario: '12:00', observacao: 'Sem lactose', modo: 'calculado', descricaoLivre: null,
  ...(incluirObservacao === undefined ? {} : { incluirObservacao }),
  itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '120', medida: null, substituiItemId: null }],
});
const formulario = (dados: unknown) => {
  const fd = new FormData();
  fd.set('dados', JSON.stringify(dados));
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

describe('salvarComoMinhaRefeicaoAction (US-237 "Salvar do editor")', () => {
  it('salva sem a observação, com "Refeição salva em Minhas refeições." e a refeição para o "Carregar"; a lista é revalidada', async () => {
    const N = await nutri();
    const r = await salvarComoMinhaRefeicaoAction(almoco());
    expect(r.ok).toBe('Refeição salva em Minhas refeições.');
    expect(r.refeicao).toMatchObject({ nome: 'Almoço leve', tipo: 'Almoço', modo: 'calculado' });
    expect((await carregarMinhaRefeicao(N.ctx, r.refeicao!.id, db))!.observacao).toBe('');
    expect(revalidatePath).toHaveBeenCalledWith('/painel/planos/refeicoes');
    const com = await salvarComoMinhaRefeicaoAction(almoco(true));
    expect((await carregarMinhaRefeicao(N.ctx, com.refeicao!.id, db))!.observacao).toBe('Sem lactose');
  });

  it('erros por campo voltam ao diálogo, sem gravar', async () => {
    const N = await nutri();
    expect(await salvarComoMinhaRefeicaoAction({ ...almoco(), nome: '', tipo: 'Brunch' })).toEqual({ erros: { nome: MSG_MINHAS_REFEICOES.nome, tipo: MSG_MINHAS_REFEICOES.tipo } });
    expect(await listarMinhasRefeicoes(N.ctx, {}, db)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('carregarMinhaRefeicaoAction (US-237 "Carregar")', () => {
  it('devolve a refeição com ids novos e os 7 dias; de outro consultório → "Refeição não encontrada."', async () => {
    await nutri();
    const { refeicao } = await salvarComoMinhaRefeicaoAction(almoco());
    const r = await carregarMinhaRefeicaoAction(refeicao!.id, 'calculado');
    expect(r.refeicao).toMatchObject({ nome: 'Almoço leve', horario: '12:00', diasSemana: [0, 1, 2, 3, 4, 5, 6] });
    expect(r.refeicao!.id).not.toBe(refeicao!.id);
    expect((await carregarMinhaRefeicaoAction(refeicao!.id, 'livre')).refeicao).toMatchObject({ itens: [], descricaoLivre: expect.stringMatching(/ — 120 g$/) });
    await nutri();
    expect(await carregarMinhaRefeicaoAction(refeicao!.id, 'calculado')).toEqual({ erro: MSG_MINHAS_REFEICOES.naoEncontrada });
  });
});

describe('alterar e excluir (US-237 "Tela de cadastro")', () => {
  it('alterar fica na página com "Refeição salva."; excluir volta à lista; de outro consultório → "Refeição não encontrada."', async () => {
    const N = await nutri();
    const { refeicao } = await salvarComoMinhaRefeicaoAction(almoco());
    const id = refeicao!.id;
    expect(await alterarMinhaRefeicaoAction(id, {}, formulario({ ...almoco(), nome: 'Almoço de domingo' }))).toEqual({ ok: MSG_MINHAS_REFEICOES.alterada });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/planos/refeicoes/${id}`);
    expect((await carregarMinhaRefeicao(N.ctx, id, db))!.nome).toBe('Almoço de domingo');
    expect(await alterarMinhaRefeicaoAction(id, {}, formulario({ ...almoco(), nome: '' }))).toEqual({ erros: { nome: MSG_MINHAS_REFEICOES.nome } });

    await nutri();
    expect(await excluirMinhaRefeicaoAction(id)).toEqual({ erros: { geral: MSG_MINHAS_REFEICOES.naoEncontrada } });
    req.headers = new Headers({ cookie: N.cookie });
    expect(await redirecionouPara(excluirMinhaRefeicaoAction(id))).toBe('/painel/planos/refeicoes');
    expect(await listarMinhasRefeicoes(N.ctx, {}, db)).toEqual([]);
  });
});
