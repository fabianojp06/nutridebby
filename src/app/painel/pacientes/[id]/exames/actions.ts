'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { excluirExame } from '@/modules/pacientes/exames';

export async function excluirExameAction(patientId: string, id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  try {
    await excluirExame(ctx, patientId, id);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
