'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PlanoError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { criarDeModelo, criarModelo, excluirModelo, salvarComoModelo } from '@/modules/plano-alimentar/modelos';

export type ModeloState = { erro?: string; ok?: string };
const mensagem = (e: PlanoError) => Object.values(e.erros)[0];

export async function criarModeloAction(_prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/planos/modelos');
  let id: string;
  try {
    ({ id } = await criarModelo(ctx, fd.get('titulo')));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    throw e;
  }
  redirect(`/painel/planos/modelos/${id}`);
}

export async function excluirModeloAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/planos/modelos/${id}`);
  try {
    await excluirModelo(ctx, id);
  } catch (e) {
    if (!(e instanceof PlanoNaoEncontradoError)) throw e;
  }
  revalidatePath('/painel/planos/modelos');
  redirect('/painel/planos/modelos');
}

export async function salvarComoModeloAction(planId: string, _prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/planos/modelos');
  try {
    await salvarComoModelo(ctx, planId, fd.get('titulo'));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    if (e instanceof PlanoNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath('/painel/planos/modelos');
  return { ok: 'Modelo salvo.' };
}

export async function criarDeModeloAction(patientId: string, _prev: ModeloState, fd: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  let id: string;
  try {
    ({ id } = await criarDeModelo(ctx, String(fd.get('modelo') ?? ''), patientId));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: mensagem(e) };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}
