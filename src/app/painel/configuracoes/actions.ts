'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { ativarIa, AtivacaoIaError, desativarIa } from '@/modules/ia/ativacao';

export type AtivarIaState = { erro?: string; ok?: boolean };

/** US-101 "Ativar": a usuária, o consultório e o IP vêm da sessão (requireNutri), nunca do formulário. */
export async function ativarIaAction(_prev: AtivarIaState, fd: FormData): Promise<AtivarIaState> {
  const { data, tenant, ctx } = await requireNutri('/painel/configuracoes');
  try {
    await ativarIa({ userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null }, fd.get('aceite') === '1');
  } catch (e) {
    if (e instanceof AtivacaoIaError) return { erro: e.mensagem };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  return { ok: true };
}

/** US-101 "Desativar". */
export async function desativarIaAction(): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  await desativarIa(ctx);
  revalidatePath('/painel', 'layout');
}
