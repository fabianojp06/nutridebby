'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';

/** Plano 16 (US-195): "Não mostrar peso no app" (caixa marcada = ligar). Bloqueado/anonimizado: nada muda (a tela já é só leitura). */
export async function pesoOcultoAction(patientId: string, formData: FormData): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/evolucao`);
  try {
    await definirPesoOculto(ctx, patientId, formData.get('ocultar') === 'on');
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
