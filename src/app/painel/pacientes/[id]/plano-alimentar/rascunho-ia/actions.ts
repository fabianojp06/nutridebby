'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { descartarSugestao } from '@/modules/ia/conferencia';
import { configIA } from '@/modules/ia/modo';
import { MetasError, pedirRascunhoIa, RascunhoExisteError, RascunhoIaError, usarComoRascunho } from '@/modules/ia/rascunho-ia';
import { PedidoIaError } from '@/modules/ia/tarefas';
import { idValido, MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

const tela = (patientId: string) => `/painel/pacientes/${patientId}/plano-alimentar/rascunho-ia`;

export type MetasState = { erros?: Record<string, string>; erro?: string };

/**
 * US-121 "Gerar rascunho": o formulário vira o objeto que `pedirRascunhoIa` valida (`validarMetas`): as refeições na
 * ordem da tela (`refeicaoNome`/`refeicaoHorario`), as porcentagens sem padrão (R10) e "Considerar a anamnese" só com a
 * caixa marcada. Erros por campo (MetasError) ou a mensagem pronta do pedido (PedidoIaError) voltam à tela.
 */
export async function pedirRascunhoIaAction(patientId: string, _prev: MetasState, fd: FormData): Promise<MetasState> {
  const { ctx, tenant } = await requireNutri(tela(patientId));
  const horarios = fd.getAll('refeicaoHorario');
  const bruto = {
    metaKcal: fd.get('metaKcal'),
    proteinaPct: fd.get('proteinaPct'),
    carboidratoPct: fd.get('carboidratoPct'),
    lipidioPct: fd.get('lipidioPct'),
    refeicoes: fd.getAll('refeicaoNome').map((nome, i) => ({ nome, horario: horarios[i] ?? '' })),
    restricoes: fd.get('restricoes') ?? '',
    considerarAnamnese: fd.get('considerarAnamnese') === 'on',
  };
  let tarefaId: string;
  try {
    tarefaId = await pedirRascunhoIa(ctx, tenant, patientId, bruto, { ia: configIA(getEnv()) });
  } catch (e) {
    if (e instanceof MetasError) return { erros: e.erros };
    if (e instanceof PedidoIaError) return { erro: e.mensagem };
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_BLOQUEADO };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`${tela(patientId)}?tarefa=${tarefaId}`);
}

export type UsarState = { confirmar?: boolean; erro?: string };

/**
 * US-121 "Usar como rascunho" (RN-122, A-D12): o rascunho do paciente e a tarefa "aplicada" na mesma transação. Já
 * existe rascunho → a tela pergunta ("Substituir" reenvia com `substituir=1`). Abre o editor com "Rascunho criado…" e,
 * se algum alimento saiu do catálogo entre a geração e o uso, quantos itens ficaram de fora (`fora`).
 */
export async function usarComoRascunhoAction(patientId: string, tarefaId: string, _prev: UsarState, fd: FormData): Promise<UsarState> {
  const { ctx } = await requireNutri(tela(patientId));
  let r: { planId: string; foraDoCatalogo: number };
  try {
    r = await usarComoRascunho(ctx, patientId, tarefaId, { substituir: fd.get('substituir') === '1' }, { destino: configIA(getEnv()).destino });
  } catch (e) {
    if (e instanceof RascunhoExisteError) return { confirmar: true };
    if (e instanceof RascunhoIaError) return { erro: e.mensagem };
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_BLOQUEADO };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${r.planId}?ia=criado${r.foraDoCatalogo > 0 ? `&fora=${r.foraDoCatalogo}` : ''}`);
}

/** "Descartar sugestão": a prévia é esvaziada e a tarefa fica "descartada" (com quem e quando); o plano não muda. */
export async function descartarRascunhoIaAction(patientId: string, tarefaId: string): Promise<void> {
  const { ctx } = await requireNutri(tela(patientId));
  if (!idValido(patientId) || !idValido(tarefaId)) notFound();
  await descartarSugestao(ctx, patientId, tarefaId);
  revalidatePath(tela(patientId));
  redirect(tela(patientId));
}
