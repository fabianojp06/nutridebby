'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { confirmarRecebimentoNoPortal } from '@/modules/documentos/portal';

/** D4 / US-146: "Confirmo que recebi este documento" (só documento assinado; o módulo confere o id, a situação e o D20). */
export async function confirmarRecebimentoAction(docId: string): Promise<void> {
  const { ctx } = await requirePaciente('/p/documentos');
  await confirmarRecebimentoNoPortal(ctx, docId);
  revalidatePath('/p/documentos');
}
