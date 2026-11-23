'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA, MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { criarBloqueio, criarRegra, DisponibilidadeError, excluirBloqueio, excluirRegra } from '@/modules/agenda/disponibilidade';
import { salvarConfirmacaoDosPedidos } from '@/modules/agenda/solicitacoes';

export type FormAgendaState = { erros?: Record<string, string>; valores?: Record<string, string>; ok?: string; envio?: number };
const CAMINHO = '/painel/agenda/horarios';
const valores = (fd: FormData, campos: string[]) => Object.fromEntries(campos.map((c) => [c, String(fd.get(c) ?? '')]));

export async function criarRegraAction(_prev: FormAgendaState, fd: FormData): Promise<FormAgendaState> {
  const { ctx } = await requireNutri(CAMINHO);
  // Plano 23 (RN-410): o local e a marca "Também atender por videoconferência nestes horários" no lugar da modalidade
  const v = valores(fd, ['diaSemana', 'inicio', 'fim', 'duracaoMin', 'localId', 'tambemOnline']);
  try {
    await criarRegra(ctx, v);
  } catch (e) {
    if (e instanceof DisponibilidadeError) return { erros: e.erros, valores: v };
    throw e;
  }
  revalidatePath(CAMINHO);
  return { ok: MSG_AGENDA.horarioCriado, envio: Date.now() };
}

export async function excluirRegraAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(CAMINHO);
  await excluirRegra(ctx, id);
  revalidatePath(CAMINHO);
}

export async function criarBloqueioAction(_prev: FormAgendaState, fd: FormData): Promise<FormAgendaState> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  const v = valores(fd, ['dataInicio', 'horaInicio', 'dataFim', 'horaFim', 'motivo']);
  try {
    await criarBloqueio(ctx, tenant, v);
  } catch (e) {
    if (e instanceof DisponibilidadeError) return { erros: e.erros, valores: v };
    throw e;
  }
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
  return { ok: 'Bloqueio adicionado.', envio: Date.now() };
}

export async function excluirBloqueioAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(CAMINHO);
  await excluirBloqueio(ctx, id);
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
}

export type ChaveState = { ok?: string; erro?: string };

/**
 * Plano 23 (US-407, RN-420): "Confirmar os pedidos antes de marcar". A caixa desmarcada não vai no formulário: desliga. As
 * telas com a aba "Solicitações" e o Início se refazem (a aba aparece com a chave ligada).
 */
export async function salvarChaveAction(_prev: ChaveState, fd: FormData): Promise<ChaveState> {
  const { ctx } = await requireNutri(CAMINHO);
  await salvarConfirmacaoDosPedidos(ctx, fd.get('confirmar') === 'on');
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
  revalidatePath('/painel');
  return { ok: MSG_SOLICITACOES.chave.salva };
}
