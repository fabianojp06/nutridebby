'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { cancelarConsulta } from '@/modules/agenda/cancelamento';
import { agendarPelaNutri, ConsultaError, ConsultaNaoEncontradaError, moverConsulta } from '@/modules/agenda/consultas';
import { registrarPresenca, type SituacaoPresenca } from '@/modules/agenda/presenca';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type ConsultaState = { erros?: Record<string, string>; valores?: Record<string, string> };

// Plano 23 (RN-407): o local no lugar da modalidade (a modalidade é o tipo do local)
const CAMPOS = ['patientId', 'data', 'hora', 'duracaoMin', 'localId', 'linkOnline'] as const;
const valores = (fd: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(fd.get(c) ?? '')])) as Record<(typeof CAMPOS)[number], string>;

function tratar(e: unknown, v: Record<string, string>): ConsultaState {
  if (e instanceof ConsultaError) return { erros: e.erros, valores: v };
  if (e instanceof PacienteBloqueadoError) return { erros: { patientId: e.message }, valores: v };
  if (e instanceof PacienteNaoEncontradoError) return { erros: { patientId: 'Selecione o paciente' }, valores: v };
  if (e instanceof ConsultaNaoEncontradaError) notFound();
  throw e;
}

export async function agendarAction(_prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri('/painel/agenda/nova');
  const v = valores(fd);
  let r: Awaited<ReturnType<typeof agendarPelaNutri>>;
  try {
    r = await agendarPelaNutri(ctx, tenant, v);
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${r.id}?ok=marcada${r.avisos.length ? `&avisos=${r.avisos.join(',')}` : ''}`);
}

export async function moverAction(id: string, _prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const v = valores(fd);
  let r: Awaited<ReturnType<typeof moverConsulta>>;
  try {
    r = await moverConsulta(ctx, tenant, id, v);
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${id}?ok=alterada${r.avisos.length ? `&avisos=${r.avisos.join(',')}` : ''}`);
}

/** US-033: a nutricionista cancela a qualquer momento (motivo opcional, só ela vê); o paciente recebe o aviso. */
export async function cancelarAction(id: string, _prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const v = { motivo: String(fd.get('motivo') ?? '') };
  try {
    await cancelarConsulta(ctx, tenant, id, { por: 'nutri', motivo: v.motivo });
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${id}?ok=cancelada`);
}

/**
 * US-037: "Realizada" ou "Faltou" depois do início (pode corrigir); erros do domínio aparecem com role="alert".
 * Plano 20 (RN-310): o resultado da cobrança vai na URL (`&cobranca=`); o valor não (ficaria no histórico do navegador):
 * a página o lê da própria cobrança.
 */
export async function presencaAction(id: string, situacao: SituacaoPresenca): Promise<ConsultaState> {
  const { ctx } = await requireNutri(`/painel/agenda/consultas/${id}`);
  if (situacao !== 'realizada' && situacao !== 'faltou') notFound(); // argumento ligado no servidor; nunca outro valor
  let r: Awaited<ReturnType<typeof registrarPresenca>>;
  try {
    r = await registrarPresenca(ctx, id, situacao);
  } catch (e) {
    return tratar(e, {});
  }
  revalidatePath('/painel/agenda');
  if (r.cobranca) revalidatePath('/painel/financeiro', 'layout');
  redirect(`/painel/agenda/consultas/${id}?ok=presenca${r.cobranca ? `&cobranca=${r.cobranca.tipo}` : ''}`);
}
