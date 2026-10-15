'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { marcarComoVista } from '@/modules/ia/nutri-paciente/duvidas';

/**
 * US-175 "Marcar como vista" (D24 = b): sem campo de texto livre. Gravou → a fila com "Dúvida marcada como vista."
 * (`?vista=1`); já resolvida, apagada (D22) ou de outro consultório → a fila, sem o aviso. A usuária e o consultório vêm da
 * sessão; o id, da URL (o módulo valida). O contador do menu muda: revalida o layout.
 */
export async function marcarVistaAction(id: string): Promise<void> {
  const { ctx } = await requireNutri('/painel/duvidas');
  const gravou = await marcarComoVista(ctx, id);
  revalidatePath('/painel', 'layout');
  redirect(gravou ? '/painel/duvidas?vista=1' : '/painel/duvidas');
}
