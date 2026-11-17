'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_LISTAS } from '@/modules/plano-alimentar/biblioteca-constantes';
import { excluirLista, ListaError, salvarLista } from '@/modules/plano-alimentar/listas';

const LISTA = '/painel/planos/listas';

export type ListaState = { erros?: Record<string, string>; ok?: string };

/** O formulário manda a lista como JSON num campo só (`dados`): grupos e itens não cabem em campos soltos. */
function lerDados(fd: FormData): unknown {
  const bruto = fd.get('dados');
  try {
    return typeof bruto === 'string' ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

/**
 * US-238: `id` nulo = "Nova lista" (a página `/painel/planos/listas/novo`); salvar cria e vai para a página da lista
 * criada. Alterar fica na página, com "Lista salva.". O formulário guarda o que foi digitado no estado do cliente.
 */
export async function salvarListaAction(id: string | null, _prev: ListaState, fd: FormData): Promise<ListaState> {
  const { ctx } = await requireNutri(`${LISTA}/${id ?? 'novo'}`);
  let salva: { id: string };
  try {
    salva = await salvarLista(ctx, id, lerDados(fd));
  } catch (e) {
    if (e instanceof ListaError) return { erros: e.erros };
    throw e;
  }
  revalidatePath(LISTA);
  if (id === null) redirect(`${LISTA}/${salva.id}`);
  revalidatePath(`${LISTA}/${id}`);
  return { ok: MSG_LISTAS.salva };
}

/** Depois da confirmação (`MSG_LISTAS.excluir`), volta às listas. Usada com `useActionState`. */
export async function excluirListaAction(id: string): Promise<ListaState> {
  const { ctx } = await requireNutri(`${LISTA}/${id}`);
  try {
    await excluirLista(ctx, id);
  } catch (e) {
    if (e instanceof ListaError) return { erros: e.erros };
    throw e;
  }
  revalidatePath(LISTA);
  redirect(LISTA);
}
