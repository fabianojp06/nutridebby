'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { agendarComoPaciente } from '@/modules/agenda/agendamento-paciente';
import { retornoDaConfirmacao } from '@/modules/agenda/acoes-link';
import { cancelarConsulta, confirmarPresenca, pedirRemarcacao, remarcarComoPaciente } from '@/modules/agenda/cancelamento';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { ConsultaError, ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';

export type AgendaState = { ok?: string; erro?: string };

function tratar(e: unknown): AgendaState {
  if (e instanceof ConsultaError) return { erro: e.erros.inicio ?? e.erros.geral ?? MSG_AGENDA.naoAgendavel };
  if (e instanceof ConsultaNaoEncontradaError) return { erro: MSG_AGENDA.naoEncontrada };
  if (e instanceof PacienteBloqueadoError) return { erro: MSG_AGENDA.contaIndisponivel };
  throw e;
}

export async function agendarAction(_: AgendaState, formData: FormData): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente('/p/agenda/nova');
  try {
    await agendarComoPaciente(ctx, tenant, { inicio: formData.get('inicio'), modalidade: formData.get('modalidade') });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  return { ok: `Consulta marcada para ${quandoComFuso(new Date(String(formData.get('inicio'))), tenant.fuso)}.` };
}

export async function confirmarAction(id: string): Promise<AgendaState> {
  const { ctx } = await requirePaciente(`/p/agenda/${id}`);
  try {
    const r = retornoDaConfirmacao(await confirmarPresenca(ctx, id, 'link'));
    revalidatePath(`/p/agenda/${id}`);
    return r;
  } catch (e) {
    return tratar(e);
  }
}

export async function cancelarAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    await cancelarConsulta(ctx, tenant, id, { por: 'paciente' });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  return { ok: MSG_AGENDA.cancelada };
}

export async function remarcarAction(id: string, _: AgendaState, formData: FormData): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    const novo = await remarcarComoPaciente(ctx, tenant, id, { inicio: formData.get('inicio'), modalidade: formData.get('modalidade') });
    revalidatePath('/p/agenda');
    return { ok: MSG_AGENDA.remarcada(quandoComFuso(novo.inicio, tenant.fuso)) };
  } catch (e) {
    return tratar(e);
  }
}

export async function avisarAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    await pedirRemarcacao(ctx, tenant, id);
  } catch (e) {
    return tratar(e);
  }
  return { ok: MSG_AGENDA.avisoDeRemarcacao };
}
