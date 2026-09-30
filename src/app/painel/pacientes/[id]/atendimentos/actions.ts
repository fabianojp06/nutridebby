'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  AtendimentoError,
  atualizarAtendimento,
  registrarAtendimento,
} from '@/modules/pacientes/atendimentos';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AtendimentoState = {
  erros?: Record<string, string>;
  valores?: Record<string, string>;
  ok?: boolean;
};

const valoresDo = (f: FormData) => ({
  data: String(f.get('data') ?? ''),
  notasPrivadas: String(f.get('notasPrivadas') ?? ''),
  orientacoes: String(f.get('orientacoes') ?? ''),
});

function tratar(e: unknown, valores: Record<string, string>): AtendimentoState {
  if (e instanceof AtendimentoError) return { erros: e.erros, valores };
  if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
  if (e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function registrarAtendimentoAction(
  patientId: string,
  _prev: AtendimentoState,
  formData: FormData,
): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos`);
  const valores = valoresDo(formData);
  let id: string;
  try {
    id = await registrarAtendimento(ctx, tenant, patientId, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  redirect(`/painel/pacientes/${patientId}/atendimentos/${id}`);
}

export async function atualizarAtendimentoAction(
  patientId: string,
  id: string,
  _prev: AtendimentoState,
  formData: FormData,
): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos/${id}`);
  const valores = valoresDo(formData);
  try {
    await atualizarAtendimento(ctx, tenant, patientId, id, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  revalidatePath(`/painel/pacientes/${patientId}/atendimentos`, 'layout');
  return { ok: true };
}
