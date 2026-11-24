'use server';

import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { excluirModeloSolicitacao, ModeloSolicitacaoError, salvarModeloSolicitacao } from '@/modules/exames/modelos-solicitacao';
import { novoMarcador } from '../valores';

/** Plano 22 (T3, US-376): as actions dos modelos de solicitação. Erro devolve `valores` (nome, exames em JSON e orientações) e `envio`. */
export type ModeloSolicitacaoState = { erros?: Record<string, string>; valores?: { nome: string; exames: string; orientacoes: string }; envio?: number };

const LISTA = '/painel/exames/modelos';
const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/** A lista de exames vem do formulário como JSON (`exames`); o que não for uma lista vira lista vazia ("Inclua ao menos um exame."). */
function examesDoFormulario(fd: FormData): unknown {
  try {
    const v: unknown = JSON.parse(texto(fd.get('exames')) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function salvarModeloSolicitacaoAction(id: string | null, _prev: ModeloSolicitacaoState, fd: FormData): Promise<ModeloSolicitacaoState> {
  const { ctx } = await requireNutri(id ? `${LISTA}/${id}` : `${LISTA}/novo`);
  try {
    await salvarModeloSolicitacao(ctx, id, { nome: fd.get('nome'), exames: examesDoFormulario(fd), orientacoes: fd.get('orientacoes') });
  } catch (e) {
    if (e instanceof ModeloSolicitacaoError) {
      return { erros: e.erros, valores: { nome: texto(fd.get('nome')), exames: texto(fd.get('exames')), orientacoes: texto(fd.get('orientacoes')) }, envio: Date.now() };
    }
    throw e;
  }
  redirect(`${LISTA}?ok=salvo&r=${novoMarcador()}`);
}

export async function excluirModeloSolicitacaoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(LISTA);
  const excluiu = await excluirModeloSolicitacao(ctx, id);
  redirect(excluiu ? `${LISTA}?ok=excluido&r=${novoMarcador()}` : LISTA);
}
