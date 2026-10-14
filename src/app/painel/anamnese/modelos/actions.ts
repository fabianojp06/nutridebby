'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AnamneseError, aprovarModeloAnamnese, arquivarModelo, salvarModelo } from '@/modules/pacientes/anamnese';

export type ModeloState = { erros?: Record<string, string> };

export async function salvarModeloAction(id: string | null, _prev: ModeloState, formData: FormData): Promise<ModeloState> {
  const { ctx } = await requireNutri('/painel/anamnese/modelos');
  let modelo: { nome?: unknown; perguntas?: unknown } = {};
  try {
    modelo = JSON.parse(String(formData.get('modelo') ?? '{}'));
  } catch {
    // corpo adulterado: cai na validação como modelo vazio
  }
  try {
    await salvarModelo(ctx, id, { nome: modelo.nome, perguntas: modelo.perguntas });
  } catch (e) {
    if (e instanceof AnamneseError) return { erros: e.erros };
    throw e;
  }
  revalidatePath('/painel/anamnese/modelos');
  redirect('/painel/anamnese/modelos');
}

export async function arquivarModeloAction(id: string): Promise<void> {
  const { ctx } = await requireNutri('/painel/anamnese/modelos');
  await arquivarModelo(ctx, id);
  revalidatePath('/painel/anamnese/modelos');
}

/** US-123 "Aprovar modelo" (anamnese): quem aprova é a usuária da sessão (o módulo e o gatilho conferem); sem origem IA → 404. */
export async function aprovarModeloAnamneseAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/anamnese/modelos/${id}`);
  try {
    await aprovarModeloAnamnese(ctx, id);
  } catch (e) {
    if (e instanceof AnamneseError) notFound();
    throw e;
  }
  revalidatePath('/painel/anamnese/modelos');
  revalidatePath(`/painel/anamnese/modelos/${id}`);
}
