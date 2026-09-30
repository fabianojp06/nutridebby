'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { atualizarPaciente, criarPaciente, PacienteError, type ErrosPaciente } from '@/modules/pacientes/pacientes';
import { valoresDoFormulario, type ValoresPaciente } from './valores';

export type PacienteState = { erros?: ErrosPaciente; valores?: ValoresPaciente; ok?: boolean };

export async function criarPacienteAction(_prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri('/painel/pacientes/novo');
  const valores = valoresDoFormulario(formData);
  let id: string;
  try {
    id = (await criarPaciente(ctx, tenant, valores)).id;
  } catch (e) {
    if (e instanceof PacienteError) return { erros: e.erros, valores };
    throw e;
  }
  redirect(`/painel/pacientes/${id}`);
}

export async function atualizarPacienteAction(patientId: string, _prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}`);
  const valores = valoresDoFormulario(formData);
  try {
    await atualizarPaciente(ctx, tenant, patientId, valores);
  } catch (e) {
    if (e instanceof PacienteError) return { erros: e.erros, valores };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return { ok: true };
}
