'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AlimentoError, criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { cadastrarMedida, excluirMedida, MedidaError } from '@/modules/alimentos/medidas';

export type AlimentoState = { erros?: Record<string, string>; valores?: Record<string, string> };
export type MedidaState = { erros?: Record<string, string>; ok?: string; envio?: number };

const campos = (fd: FormData) => ({
  nome: fd.get('nome'),
  grupo: fd.get('grupo'),
  kcal: fd.get('kcal'),
  proteinaG: fd.get('proteinaG'),
  carboidratoG: fd.get('carboidratoG'),
  lipidioG: fd.get('lipidioG'),
  fibraG: fd.get('fibraG'),
});
const valores = (fd: FormData) => Object.fromEntries(Object.entries(campos(fd)).map(([k, v]) => [k, typeof v === 'string' ? v : '']));

export async function criarAlimentoAction(_prev: AlimentoState, fd: FormData): Promise<AlimentoState> {
  const { ctx } = await requireNutri('/painel/alimentos/novo');
  let id: string;
  try {
    ({ id } = await criarAlimento(ctx, campos(fd)));
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros, valores: valores(fd) };
    throw e;
  }
  redirect(`/painel/alimentos/${id}`);
}

export async function editarAlimentoAction(id: string, _prev: AlimentoState, fd: FormData): Promise<AlimentoState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}/editar`);
  try {
    await editarAlimento(ctx, id, campos(fd));
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros, valores: valores(fd) };
    throw e;
  }
  revalidatePath(`/painel/alimentos/${id}`);
  redirect(`/painel/alimentos/${id}`);
}

/** Usada com `useActionState`: o estado anterior chega como 2º argumento e não é preciso. */
export async function excluirAlimentoAction(id: string): Promise<AlimentoState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  try {
    await excluirAlimento(ctx, id);
  } catch (e) {
    if (e instanceof AlimentoError) return { erros: e.erros };
    throw e;
  }
  redirect('/painel/alimentos');
}

export async function duplicarAlimentoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/alimentos/${id}`);
  let novo: { id: string; incompleto: boolean };
  try {
    novo = await duplicarComoMeu(ctx, id);
  } catch (e) {
    if (e instanceof AlimentoError) notFound();
    throw e;
  }
  redirect(`/painel/alimentos/${novo.id}/editar${novo.incompleto ? '?incompleto=1' : ''}`);
}

export async function cadastrarMedidaAction(foodId: string, _prev: MedidaState, fd: FormData): Promise<MedidaState> {
  const { ctx } = await requireNutri(`/painel/alimentos/${foodId}`);
  try {
    const m = await cadastrarMedida(ctx, foodId, { nome: fd.get('nome'), plural: fd.get('plural'), gramas: fd.get('gramas') });
    revalidatePath(`/painel/alimentos/${foodId}`);
    return { ok: `Medida "${m.nome}" cadastrada.`, envio: Date.now() };
  } catch (e) {
    if (e instanceof MedidaError) return { erros: e.erros };
    throw e;
  }
}

export async function excluirMedidaAction(foodId: string, medidaId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/alimentos/${foodId}`);
  await excluirMedida(ctx, medidaId);
  revalidatePath(`/painel/alimentos/${foodId}`);
}
