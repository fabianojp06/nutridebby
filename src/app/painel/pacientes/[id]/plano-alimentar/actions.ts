'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { criarRascunho, descartarRascunho } from '@/modules/plano-alimentar/rascunho';

export type AcaoPlanoState = { erro?: string };

/** Usada com `useActionState` (BotaoAcao): o estado anterior que o React passa é ignorado. */
export async function criarRascunhoAction(patientId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  let id: string;
  try {
    ({ id } = await criarRascunho(ctx, patientId));
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}

export async function descartarRascunhoAction(patientId: string, planId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  try {
    await descartarRascunho(ctx, planId);
  } catch (e) {
    if (!(e instanceof PlanoNaoEncontradoError || e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`);
  redirect(`/painel/pacientes/${patientId}/plano-alimentar`);
}
