'use server';
import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { ComentarioError, comentarRegistro, MSG_COMENTARIO } from '@/modules/portal/diario-nutri';

export type ComentarioState = { erro?: string; ok?: string; valor?: string };

export async function comentarAction(id: string, _: ComentarioState, formData: FormData): Promise<ComentarioState> {
  const { ctx } = await requireNutri(`/painel/diarios/${id}`);
  const valor = String(formData.get('comentario') ?? '');
  try {
    await comentarRegistro(ctx, id, valor);
  } catch (e) {
    if (e instanceof ComentarioError) return { erro: e.erros.comentario, valor };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message, valor }; // corrida com o bloqueio: a página já esconde o formulário
    throw e;
  }
  revalidatePath(`/painel/diarios/${id}`);
  return { ok: MSG_COMENTARIO.salvo };
}
