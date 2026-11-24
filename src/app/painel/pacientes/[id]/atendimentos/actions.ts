'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { AtendimentoError, atualizarAtendimento, registrarAtendimento } from '@/modules/pacientes/atendimentos';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type AtendimentoState = { erros?: Record<string, string>; valores?: Record<string, string>; ok?: boolean };

const valoresDo = (f: FormData) => ({
  data: String(f.get('data') ?? ''),
  notasPrivadas: String(f.get('notasPrivadas') ?? ''),
  orientacoes: String(f.get('orientacoes') ?? ''),
  // Plano 23 (US-410): "Retorno previsto (opcional)" — a data ou "Em {n} semanas"
  retornoPrevistoEm: String(f.get('retornoPrevistoEm') ?? ''),
  retornoSemanas: String(f.get('retornoSemanas') ?? ''),
});

function tratar(e: unknown, valores: Record<string, string>): AtendimentoState {
  if (e instanceof AtendimentoError) return { erros: e.erros, valores };
  if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
  if (e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function registrarAtendimentoAction(patientId: string, _prev: AtendimentoState, formData: FormData): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos`);
  const valores = valoresDo(formData);
  let r: Awaited<ReturnType<typeof registrarAtendimento>>;
  try {
    // Plano 05: "Iniciar atendimento" pela agenda manda o id da consulta (só o registro usa)
    r = await registrarAtendimento(ctx, tenant, patientId, { ...valores, appointmentId: String(formData.get('appointmentId') ?? '') });
  } catch (e) {
    return tratar(e, valores);
  }
  // Plano 20 (RN-310): só com consulta ligada que passou a "Realizada" (cobranca não nula); o valor não vai na URL
  if (r.cobranca) revalidatePath('/painel/financeiro', 'layout');
  redirect(`/painel/pacientes/${patientId}/atendimentos/${r.id}${r.cobranca ? `?ok=atendimento&cobranca=${r.cobranca.tipo}` : ''}`);
}

export async function atualizarAtendimentoAction(patientId: string, id: string, _prev: AtendimentoState, formData: FormData): Promise<AtendimentoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/atendimentos/${id}`);
  const valores = valoresDo(formData);
  try {
    await atualizarAtendimento(ctx, tenant, patientId, id, valores);
  } catch (e) {
    return tratar(e, valores);
  }
  revalidatePath(`/painel/pacientes/${patientId}/atendimentos`, 'layout');
  return { ok: true };
}
