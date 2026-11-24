'use server';

import { redirect } from 'next/navigation';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { novoMarcador } from '@/app/painel/exames/valores';
import { DocumentoError } from '@/modules/documentos/erros';
import { excluirItemSalvo, salvarItemSalvo } from '@/modules/documentos/modelos';
import { grupoDaUrl, grupoDoTipo, lerJson, LISTA_DE_ITENS, texto } from '../valores';

/**
 * Plano 22 (T10b, US-379, RN-393): as actions dos itens salvos. Toda action passa por `acessoComDocumentos` (RN-398: sem
 * `documentos_liberados`, `notFound()`; o papel errado é redirecionado pela sessão). O item vem do formulário como JSON
 * (`item`, como o `CamposDoItem` o guarda); erro devolve `valores` (nome e item) e `envio` (a `key` do formulário).
 */
export type ItemSalvoState = { erros?: Record<string, string>; valores?: { nome: string; item: string }; envio?: number };

export async function salvarItemSalvoAction(id: string | null, _prev: ItemSalvoState, fd: FormData): Promise<ItemSalvoState> {
  const { ctx, tenant } = await acessoComDocumentos(id ? `${LISTA_DE_ITENS}/${id}` : `${LISTA_DE_ITENS}/novo`);
  const item = lerJson(fd.get('item'));
  try {
    await salvarItemSalvo(ctx, tenant, id, { nome: fd.get('nome'), item });
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores: { nome: texto(fd.get('nome')), item: texto(fd.get('item')) }, envio: Date.now() };
    throw e;
  }
  // gravou: o item passou pelo Zod, e o tipo dele decide o grupo da lista (RN-393)
  redirect(`${LISTA_DE_ITENS}?tipo=${grupoDoTipo((item as { tipo?: unknown }).tipo)}&ok=salvo&r=${novoMarcador()}`);
}

/** "Item excluído." na lista do grupo de onde veio (`grupo` fora da lista vale `suplementos`); já excluído, só a lista. */
export async function excluirItemSalvoAction(id: string, grupo: string): Promise<void> {
  const { ctx } = await acessoComDocumentos(LISTA_DE_ITENS);
  const lista = `${LISTA_DE_ITENS}?tipo=${grupoDaUrl(grupo)}`;
  const excluiu = await excluirItemSalvo(ctx, id);
  redirect(excluiu ? `${lista}&ok=excluido&r=${novoMarcador()}` : lista);
}
