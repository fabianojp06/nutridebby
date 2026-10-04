'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/session';
import { ContaError, criarContaNutri, reenviarConvite, type ErrosDeCampo } from '@/modules/plataforma/contas';
import { ajustarCotaWhatsapp, CotaWhatsappError } from '@/modules/plataforma/metricas';
import { MSG_METRICAS, salvarMetricasBase } from '@/modules/plataforma/metricas-sucesso';
import { reativarConta, suspenderConta } from '@/modules/plataforma/suspensao';
import { ContaNaoEncontradaError, MSG_CONTA_NAO_ENCONTRADA } from '@/modules/plataforma/tenant-status';

export type CriarContaState = { erros?: ErrosDeCampo; valores?: Record<string, string> };

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');
const uuid = z.guid(); // G5: mesmo formato do tipo uuid do Postgres (z.uuid() exige versão RFC)

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

/** M9: tenant inexistente (apagado, id antigo numa aba aberta) vira aviso próprio, não página de erro. */
async function naoEncontradaVira(ok: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return ok;
  } catch (e) {
    if (e instanceof ContaNaoEncontradaError) return 'nao_encontrada';
    throw e;
  }
}

export async function suspenderAction(tenantId: string): Promise<void> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  const aviso = await naoEncontradaVira('suspensa', () => suspenderConta(tenantId, user.id));
  revalidatePath('/admin');
  redirect(`/admin?aviso=${aviso}`);
}

export async function reativarAction(tenantId: string): Promise<void> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  const aviso = await naoEncontradaVira('reativada', () => reativarConta(tenantId, user.id));
  revalidatePath('/admin');
  redirect(`/admin?aviso=${aviso}`);
}

export type CotaState = { erro?: string; ok?: boolean };

export async function ajustarCotaAction(tenantId: string, _prev: CotaState, formData: FormData): Promise<CotaState> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) return { erro: 'Conta inválida' };
  try {
    await ajustarCotaWhatsapp(tenantId, String(formData.get('cota') ?? ''), user.id);
  } catch (e) {
    if (e instanceof CotaWhatsappError) return { erro: e.message };
    if (e instanceof ContaNaoEncontradaError) return { erro: MSG_CONTA_NAO_ENCONTRADA };
    throw e;
  }
  revalidatePath('/admin');
  return { ok: true };
}

export type MetricasState = { ok?: boolean; erro?: string; campo?: 'taxaBase' | 'goLiveEm' };

/** D15: base do CS-03 (P-15) e início do uso (CS-01) do tenant. */
export async function salvarMetricasAction(tenantId: string, _prev: MetricasState, formData: FormData): Promise<MetricasState> {
  await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) return { erro: MSG_CONTA_NAO_ENCONTRADA };
  try {
    await salvarMetricasBase(tenantId, { taxaBase: campo(formData, 'taxaBase'), goLiveEm: campo(formData, 'goLiveEm') });
  } catch (e) {
    if (e instanceof Error && e.message === MSG_METRICAS.taxa) return { erro: e.message, campo: 'taxaBase' };
    if (e instanceof Error && e.message === MSG_METRICAS.data) return { erro: e.message, campo: 'goLiveEm' };
    if (e instanceof ContaNaoEncontradaError) return { erro: MSG_CONTA_NAO_ENCONTRADA };
    throw e;
  }
  revalidatePath('/admin');
  return { ok: true };
}
