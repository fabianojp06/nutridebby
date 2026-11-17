'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_MINHAS_REFEICOES, type MinhaRefeicaoDaLista } from '@/modules/plano-alimentar/biblioteca-constantes';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { alterarMinhaRefeicao, excluirMinhaRefeicao, RefeicaoModeloError, refeicaoParaPlano, salvarComoMinhaRefeicao } from '@/modules/plano-alimentar/refeicoes-modelo';
import type { ModoPlano, RefeicaoPlano } from '@/modules/plano-alimentar/tipos';

const LISTA = '/painel/planos/refeicoes';

export type MinhaRefeicaoState = { erros?: Record<string, string>; ok?: string };

/** O formulário manda a refeição como JSON num campo só (`dados`): grupos de itens não cabem em campos soltos. */
function lerDados(fd: FormData): unknown {
  const bruto = fd.get('dados');
  try {
    return typeof bruto === 'string' ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

/**
 * US-237 "Salvar do editor": chamada pelo diálogo "Salvar refeição" do editor do plano, com a refeição da tela (o
 * formato do item do PUT do editor) e `incluirObservacao`. Devolve a refeição para o "Carregar minha refeição" da
 * mesma tela já a oferecer.
 */
export async function salvarComoMinhaRefeicaoAction(entrada: unknown): Promise<MinhaRefeicaoState & { refeicao?: MinhaRefeicaoDaLista }> {
  const { ctx } = await requireNutri(LISTA);
  try {
    const refeicao = await salvarComoMinhaRefeicao(ctx, entrada);
    revalidatePath(LISTA);
    return { ok: MSG_MINHAS_REFEICOES.salva, refeicao };
  } catch (e) {
    if (e instanceof RefeicaoModeloError) return { erros: e.erros };
    throw e;
  }
}

/** US-237 "Carregar": a refeição com ids novos para o editor pôr no plano (o salvamento automático grava, D7). */
export async function carregarMinhaRefeicaoAction(id: string, modo: ModoPlano): Promise<{ refeicao?: RefeicaoPlano; erro?: string }> {
  const { ctx } = await requireNutri(LISTA);
  try {
    return { refeicao: await refeicaoParaPlano(ctx, id, modo) };
  } catch (e) {
    if (e instanceof RefeicaoModeloError) return { erro: e.erros.geral ?? MSG_PLANO.invalido };
    throw e;
  }
}

/** US-237 "Tela de cadastro": salvar fica na página, com "Refeição salva.". */
export async function alterarMinhaRefeicaoAction(id: string, _prev: MinhaRefeicaoState, fd: FormData): Promise<MinhaRefeicaoState> {
  const { ctx } = await requireNutri(`${LISTA}/${id}`);
  try {
    await alterarMinhaRefeicao(ctx, id, lerDados(fd));
  } catch (e) {
    if (e instanceof RefeicaoModeloError) return { erros: e.erros };
    throw e;
  }
  revalidatePath(LISTA);
  revalidatePath(`${LISTA}/${id}`);
  return { ok: MSG_MINHAS_REFEICOES.alterada };
}

/** Depois da confirmação (`MSG_MINHAS_REFEICOES.excluir`), volta à lista. Usada com `useActionState`. */
export async function excluirMinhaRefeicaoAction(id: string): Promise<MinhaRefeicaoState> {
  const { ctx } = await requireNutri(`${LISTA}/${id}`);
  try {
    await excluirMinhaRefeicao(ctx, id);
  } catch (e) {
    if (e instanceof RefeicaoModeloError) return { erros: e.erros };
    throw e;
  }
  revalidatePath(LISTA);
  redirect(LISTA);
}
