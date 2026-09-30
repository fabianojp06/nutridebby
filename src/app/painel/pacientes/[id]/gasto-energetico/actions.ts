'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { GastoError, salvarCalculo } from '@/modules/pacientes/gasto-energetico';

export type CalculoState = { erros?: Record<string, string>; ok?: { tmb: number; get: number } };

export async function salvarCalculoAction(
  patientId: string,
  _prev: CalculoState,
  formData: FormData,
): Promise<CalculoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/gasto-energetico`);
  try {
    const r = await salvarCalculo(ctx, tenant, patientId, {
      formula: formData.get('formula'),
      pesoKg: formData.get('pesoKg'),
      alturaCm: formData.get('alturaCm'),
      fator: formData.get('fator'),
    });
    revalidatePath(`/painel/pacientes/${patientId}/gasto-energetico`);
    return { ok: { tmb: r.tmb, get: r.get } };
  } catch (e) {
    if (e instanceof GastoError) return { erros: e.erros };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
}
