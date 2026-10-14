'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { descartarSugestao } from '@/modules/ia/conferencia';
import { configIA } from '@/modules/ia/modo';
import { pedirResumo } from '@/modules/ia/resumo';
import { PedidoIaError } from '@/modules/ia/tarefas';
import { idValido, MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type ResumoState = { erro?: string };

/**
 * US-120 "Gerar resumo" / "Gerar de novo": `notas` = a caixa "Incluir notas privadas" (desmarcada por padrão, A-D8);
 * `deNovo=1` = descarta o pronto e pede outro (sem `deNovo`, o pronto com o mesmo carimbo é reaproveitado, sem cobrança).
 */
export async function pedirResumoAction(patientId: string, _prev: ResumoState, fd: FormData): Promise<ResumoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/resumo-ia`);
  let tarefaId: string;
  try {
    ({ tarefaId } = await pedirResumo(ctx, tenant, patientId, { notasPrivadas: fd.get('notas') === 'on', gerarDeNovo: fd.get('deNovo') === '1' }, { ia: configIA(getEnv()) }));
  } catch (e) {
    if (e instanceof PedidoIaError) return { erro: e.mensagem };
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_BLOQUEADO };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/resumo-ia?tarefa=${tarefaId}`);
}

/** US-120 "Descartar resumo": o resumo é esvaziado e a tarefa fica "descartada" (com quem e quando). */
export async function descartarResumoAction(patientId: string, tarefaId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/resumo-ia`);
  if (!idValido(patientId) || !idValido(tarefaId)) notFound();
  await descartarSugestao(ctx, patientId, tarefaId);
  revalidatePath(`/painel/pacientes/${patientId}/resumo-ia`);
  redirect(`/painel/pacientes/${patientId}/resumo-ia`);
}
