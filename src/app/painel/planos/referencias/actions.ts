'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { NUTRIENTES } from '@/modules/alimentos/nutrientes';
import { excluirReferencia, ReferenciaError, salvarReferencia } from '@/modules/alimentos/referencias';
import { MSG_REFERENCIAS, nomeDoCampoDaReferencia } from '@/modules/alimentos/referencias-constantes';

export type ReferenciaState = { erros?: Record<string, string>; valores?: Record<string, string>; ok?: string };

const LISTA = '/painel/planos/referencias';
const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const CAMPOS = NUTRIENTES.flatMap((n) => [nomeDoCampoDaReferencia('meta', n.chave), nomeDoCampoDaReferencia('maximo', n.chave)]);

/** O formulário manda meta e máximo de todo o catálogo (vazio = sem valor). */
const entrada = (fd: FormData) => ({
  nome: fd.get('nome'),
  fonte: fd.get('fonte'),
  valores: Object.fromEntries(NUTRIENTES.map((n) => [n.chave, { meta: fd.get(nomeDoCampoDaReferencia('meta', n.chave)), maximo: fd.get(nomeDoCampoDaReferencia('maximo', n.chave)) }])),
});
/** O que foi digitado, para o formulário voltar preenchido com o erro. */
const valores = (fd: FormData): Record<string, string> => Object.fromEntries(['nome', 'fonte', ...CAMPOS].map((k) => [k, texto(fd.get(k))]));

/**
 * US-232: `id` nulo = "Novo perfil" (a página `/painel/planos/referencias/novo`); salvar cria e vai para a página do
 * perfil criado. Alterar fica na página, com "Perfil salvo.".
 */
export async function salvarReferenciaAction(id: string | null, _prev: ReferenciaState, fd: FormData): Promise<ReferenciaState> {
  const { ctx } = await requireNutri(`${LISTA}/${id ?? 'novo'}`);
  let salvo: { id: string };
  try {
    salvo = await salvarReferencia(ctx, id, entrada(fd));
  } catch (e) {
    if (e instanceof ReferenciaError) return { erros: e.erros, valores: valores(fd) };
    throw e;
  }
  revalidatePath(LISTA);
  if (id === null) redirect(`${LISTA}/${salvo.id}`);
  revalidatePath(`${LISTA}/${id}`);
  return { ok: MSG_REFERENCIAS.salvo, valores: valores(fd) };
}

/**
 * US-232, D30: depois da confirmação (MSG_REFERENCIAS.excluir), os rascunhos e modelos que usavam o perfil ficam "Sem
 * perfil"; os publicados mantêm a cópia. Usada com `useActionState` (o estado anterior chega como 2º argumento e não é preciso).
 */
export async function excluirReferenciaAction(id: string): Promise<ReferenciaState> {
  const { ctx } = await requireNutri(`${LISTA}/${id}`);
  try {
    await excluirReferencia(ctx, id);
  } catch (e) {
    if (e instanceof ReferenciaError) return { erros: e.erros };
    throw e;
  }
  revalidatePath(LISTA);
  redirect(LISTA);
}
