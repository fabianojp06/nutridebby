'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/session';
import { ContaError, criarContaNutri, reenviarConvite, type ErrosDeCampo } from '@/modules/plataforma/contas';

export type CriarContaState = { erros?: ErrosDeCampo; valores?: Record<string, string> };

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');
const uuid = z.uuid();

export async function criarContaAction(_prev: CriarContaState, formData: FormData): Promise<CriarContaState> {
  await requireUser(['admin'], '/admin/contas/nova');
  const valores = {
    nomeExibicao: campo(formData, 'nomeExibicao'),
    email: campo(formData, 'email'),
    crn: campo(formData, 'crn'),
    slug: campo(formData, 'slug'),
  };
  try {
    await criarContaNutri(valores);
  } catch (e) {
    if (e instanceof ContaError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath('/admin');
  redirect('/admin?aviso=criada');
}

export async function reenviarConviteAction(tenantId: string): Promise<void> {
  await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  let aviso = 'reenviado';
  try {
    await reenviarConvite(tenantId);
  } catch (e) {
    if (!(e instanceof ContaError)) throw e;
    // T5-R2: cada código do ContaError vira seu próprio aviso (a Tarefa 7 acrescenta o código
    // de "conta suspensa" — basta uma entrada nova em AVISOS, `/admin/page.tsx`, nada aqui).
    aviso = e.code;
  }
  revalidatePath('/admin');
  redirect(`/admin?aviso=${aviso}`);
}
