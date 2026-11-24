'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { TenantContext } from '@/db/tenant';
import { requireNutri } from '@/lib/tenant-session';
import { arquivarLocal, definirPrincipal, excluirLocal, LocalError, reativarLocal, salvarLocal } from '@/modules/agenda/locais';
import { chaveDoErro, type OK_LOCAIS } from './retornos';

export type LocalFormState = { erros?: Record<string, string>; valores?: Record<string, string> };

const CAMINHO = '/painel/agenda/locais';
/** O marcador da volta (`r`): muda a cada ação, para a região de status anunciar de novo e o foco ir ao h1 (RNF-401). */
const marcador = () => randomUUID().slice(0, 8);
const comRetorno = (volta: string, chave: 'ok' | 'erro', valor: string) => `${volta}${volta.includes('?') ? '&' : '?'}${chave}=${valor}&r=${marcador()}`;
const CAMPOS = ['tipo', 'nome', 'endereco', 'cidade', 'mostrarEndereco', 'linkSala', 'agendamentoOnline'] as const;

/** US-400: cria (`id` nulo) ou edita. Em erro, os valores digitados voltam ao formulário; salvo, volta à lista com "Local salvo.". */
export async function salvarLocalAction(id: string | null, _prev: LocalFormState, fd: FormData): Promise<LocalFormState> {
  const { ctx } = await requireNutri(CAMINHO);
  // só os campos que vieram (o tipo de um local em uso não vem: vale o gravado)
  const valores = Object.fromEntries(CAMPOS.filter((c) => fd.has(c)).map((c) => [c, String(fd.get(c) ?? '')]));
  try {
    await salvarLocal(ctx, id, valores);
  } catch (e) {
    if (e instanceof LocalError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath(CAMINHO);
  redirect(comRetorno(CAMINHO, 'ok', 'salvo'));
}

/** Botões da lista: a volta é pela URL, com a mensagem numa região `role="status"` (ou `role="alert"`, no erro). */
async function executar(acao: (ctx: TenantContext) => Promise<void>, ok: keyof typeof OK_LOCAIS, volta = CAMINHO): Promise<never> {
  const { ctx } = await requireNutri(CAMINHO);
  try {
    await acao(ctx);
  } catch (e) {
    if (e instanceof LocalError) redirect(comRetorno(volta, 'erro', chaveDoErro(e.erros.geral)));
    throw e;
  }
  revalidatePath(CAMINHO);
  redirect(comRetorno(volta, 'ok', ok));
}

export async function definirPrincipalAction(id: string): Promise<void> {
  await executar((ctx) => definirPrincipal(ctx, id), 'salvo');
}

export async function arquivarLocalAction(id: string): Promise<void> {
  await executar((ctx) => arquivarLocal(ctx, id), 'arquivado');
}

export async function reativarLocalAction(id: string): Promise<void> {
  await executar((ctx) => reativarLocal(ctx, id), 'reativado', `${CAMINHO}?arquivados=1`);
}

export async function excluirLocalAction(id: string, arquivados: boolean): Promise<void> {
  await executar((ctx) => excluirLocal(ctx, id), 'excluido', arquivados ? `${CAMINHO}?arquivados=1` : CAMINHO);
}
