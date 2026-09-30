'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  AntropometriaError,
  entradaDoFormulario,
  excluirAntropometria,
  registrarAntropometria,
} from '@/modules/pacientes/antropometria';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AntropometriaState = {
  erros?: Record<string, string>;
  valores?: Record<string, string>;
  aviso?: string | null;
  ok?: boolean;
  /** Muda a cada resposta: o formulário se remonta com os valores de volta (erro) ou vazio (sucesso). */
  envio?: number;
};

const textos = (f: FormData) =>
  Object.fromEntries(
    [...f.entries()].filter((e): e is [string, string] => typeof e[1] === 'string'),
  );

export async function registrarAntropometriaAction(
  patientId: string,
  _prev: AntropometriaState,
  formData: FormData,
): Promise<AntropometriaState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/antropometria`);
  const valores = textos(formData);
  try {
    const r = await registrarAntropometria(ctx, tenant, patientId, entradaDoFormulario(valores));
    revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
    return { ok: true, aviso: r.aviso, envio: Date.now() };
  } catch (e) {
    if (e instanceof AntropometriaError) return { erros: e.erros, valores, envio: Date.now() };
    if (e instanceof PacienteBloqueadoError)
      return { erros: { geral: e.message }, valores, envio: Date.now() };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
}

export async function excluirAntropometriaAction(patientId: string, id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/antropometria`);
  try {
    await excluirAntropometria(ctx, patientId, id);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
