'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AnamneseError, arquivarModelo, salvarModelo } from '@/modules/pacientes/anamnese';

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
