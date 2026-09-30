'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  AnamneseError,
  atualizarAnamnese,
  buscarModelo,
  perguntasDaAnamnese,
  preencherAnamnese,
} from '@/modules/pacientes/anamnese';
import { respostasDoFormulario } from '@/modules/pacientes/anamnese-tipos';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AnamneseState = {
  erros?: Record<string, string>;
  valores?: Record<string, string | string[]>;
  ok?: boolean;
  envio?: number;
};

function tratar(e: unknown, valores: Record<string, string | string[]>): AnamneseState {
  if (e instanceof AnamneseError) return { erros: e.erros, valores, envio: Date.now() };
  if (e instanceof PacienteBloqueadoError)
    return { erros: { geral: e.message }, valores, envio: Date.now() };
  if (e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function preencherAnamneseAction(
  patientId: string,
  modeloId: string,
  _prev: AnamneseState,
  formData: FormData,
): Promise<AnamneseState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/anamnese`);
  const modelo = await buscarModelo(ctx, modeloId);
  if (!modelo) notFound();
  const valores = respostasDoFormulario(modelo.schema.perguntas, formData);
  let id: string;
  try {
    id = await preencherAnamnese(ctx, tenant, patientId, modeloId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  redirect(`/painel/pacientes/${patientId}/anamnese/${id}`);
}

export async function atualizarAnamneseAction(
  patientId: string,
  anamneseId: string,
  _prev: AnamneseState,
  formData: FormData,
): Promise<AnamneseState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/anamnese/${anamneseId}`);
  const perguntas = await perguntasDaAnamnese(ctx, patientId, anamneseId);
  if (!perguntas) notFound();
  const valores = respostasDoFormulario(perguntas, formData);
  try {
    await atualizarAnamnese(ctx, patientId, anamneseId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  revalidatePath(`/painel/pacientes/${patientId}/anamnese/${anamneseId}`);
  return { ok: true, envio: Date.now() };
}
