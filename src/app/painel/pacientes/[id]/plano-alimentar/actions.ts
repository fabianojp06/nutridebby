'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { editarPublicado, pedirNovoPdf, publicarPlano } from '@/modules/plano-alimentar/publicacao';
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

/** US-025: publica o rascunho (arquiva o publicado anterior, congela os nutrientes e enfileira o PDF). */
export async function publicarAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  try {
    await publicarPlano(ctx, planId);
  } catch (e) {
    if (e instanceof PlanoError) return { erro: Object.values(e.erros)[0] };
    if (e instanceof PlanoNaoEditavelError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`, 'layout');
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${planId}?publicado=1`);
}

/** US-025 "Editar": cria a próxima versão em rascunho a partir do publicado (ou abre o rascunho que já existe). */
export async function editarPublicadoAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  let id: string;
  try {
    ({ id } = await editarPublicado(ctx, planId));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: Object.values(e.erros)[0] };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}

/** US-026 "Gerar o PDF de novo": só de 'falhou'; volta a pendente e o worker gera outra vez. */
export async function pedirNovoPdfAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  try {
    await pedirNovoPdf(ctx, planId);
  } catch (e) {
    if (e instanceof PlanoNaoEncontradoError) return { erro: 'O PDF já está sendo preparado.' };
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  return {};
}
