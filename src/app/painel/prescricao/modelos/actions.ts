'use server';

import { redirect } from 'next/navigation';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { novoMarcador } from '@/app/painel/exames/valores';
import { DocumentoError } from '@/modules/documentos/erros';
import { excluirModeloPrescricao, salvarModeloPrescricao } from '@/modules/documentos/modelos';
import { lerJson, LISTA_DE_MODELOS, texto } from '../valores';

/**
 * Plano 22 (T10b, US-379, RN-394): as actions dos modelos de prescrição. O modelo nasce da receita ("Salvar como modelo",
 * na action do documento); aqui, só editar e excluir. Toda action passa por `acessoComDocumentos` (RN-398). Itens e
 * orientações vêm num campo só (`conteudo`, JSON, como o editor da receita); **sem** justificativa de uso (o módulo ignora
 * qualquer outra chave). Erro devolve `valores` (nome e conteúdo) e `envio`.
 */
export type ModeloPrescricaoState = { erros?: Record<string, string>; valores?: { nome: string; conteudo: string }; envio?: number };

export async function salvarModeloPrescricaoAction(id: string, _prev: ModeloPrescricaoState, fd: FormData): Promise<ModeloPrescricaoState> {
  const { ctx, tenant } = await acessoComDocumentos(`${LISTA_DE_MODELOS}/${id}`);
  const c = (lerJson(fd.get('conteudo')) ?? {}) as { itens?: unknown; orientacoes?: unknown };
  try {
    await salvarModeloPrescricao(ctx, tenant, id, { nome: fd.get('nome'), itens: c.itens, orientacoes: c.orientacoes });
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores: { nome: texto(fd.get('nome')), conteudo: texto(fd.get('conteudo')) }, envio: Date.now() };
    throw e;
  }
  redirect(`${LISTA_DE_MODELOS}?ok=salvo&r=${novoMarcador()}`);
}

/** "Modelo excluído." — as receitas já emitidas não mudam (cópia). Já excluído, só a lista. */
export async function excluirModeloPrescricaoAction(id: string): Promise<void> {
  const { ctx } = await acessoComDocumentos(LISTA_DE_MODELOS);
  const excluiu = await excluirModeloPrescricao(ctx, id);
  redirect(excluiu ? `${LISTA_DE_MODELOS}?ok=excluido&r=${novoMarcador()}` : LISTA_DE_MODELOS);
}
