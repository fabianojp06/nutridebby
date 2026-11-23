'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { agendarComoPaciente } from '@/modules/agenda/agendamento-paciente';
import { retornoDaConfirmacao } from '@/modules/agenda/acoes-link';
import { cancelarConsulta, confirmarPresenca, pedirRemarcacao, remarcarComoPaciente } from '@/modules/agenda/cancelamento';
import { MSG_AGENDA, MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { ConsultaError, ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { desistirDoPedido, PedidoMudouError } from '@/modules/agenda/solicitacoes';
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
  let marcada: Awaited<ReturnType<typeof agendarComoPaciente>>;
  try {
    marcada = await agendarComoPaciente(ctx, tenant, { inicio: formData.get('inicio'), localId: formData.get('localId') });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  // Plano 23 (US-408, AG-D53): quem decide é o gatilho; o status devolvido diz se virou pedido (a chave ligada)
  if (marcada.status === 'solicitada') return { ok: MSG_SOLICITACOES.portal.pedidoEnviado };
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
  revalidatePath(`/p/agenda/${id}`); // a pessoa está na página da consulta: sem isto, "Confirmar"/"Cancelar" continuam na tela
  return { ok: MSG_AGENDA.cancelada };
}

/**
 * US-033 (rodada 1 da revisão da T12): remarcar cancela a consulta antiga e cria outra (D17). A página da antiga voltaria
 * "cancelada" e desmontaria o formulário com a confirmação: no sucesso, vai para a consulta nova com `?ok=remarcada`.
 */
export async function remarcarAction(id: string, _: AgendaState, formData: FormData): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  let novo: { id: string };
  try {
    novo = await remarcarComoPaciente(ctx, tenant, id, { inicio: formData.get('inicio'), localId: formData.get('localId') });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  redirect(`/p/agenda/${novo.id}?ok=remarcada`);
}

/**
 * US-035: `pedirRemarcacao` devolve false quando nada foi gravado (consulta cancelada ou já começada, paciente inativo)
 * ou quando o pedido já existia (`naMesmaTransacao` com `mudou` false: a nutricionista já foi avisada). Só no primeiro
 * caso é erro, como no link da consulta. A página se refaz nos dois (situação atual, sem o botão).
 */
export async function avisarAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  let jaPedido = false;
  let avisou: boolean;
  try {
    avisou = await pedirRemarcacao(ctx, tenant, id, {
      naMesmaTransacao: async (_tx, _c, mudou) => {
        jaPedido = !mudou;
      },
    });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath(`/p/agenda/${id}`);
  return avisou || jaPedido ? { ok: MSG_AGENDA.avisoDeRemarcacao } : { erro: MSG_AGENDA.foraDoPrazo };
}

/**
 * Plano 23 (US-408, AG-D42, AG-D70): "Desistir do pedido" — o próprio pedido ainda no prazo vira "Pedido cancelado" e a
 * nutricionista é avisada. Volta a "Minhas consultas" com `?ok=pedido-cancelado` ("Pedido cancelado." na região fixa). O
 * pedido que já mudou (respondido ou vencido) fica na própria tela com o aviso.
 */
export async function desistirAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    await desistirDoPedido(ctx, tenant, id);
  } catch (e) {
    if (e instanceof PedidoMudouError) {
      revalidatePath(`/p/agenda/${id}`);
      return { erro: MSG_SOLICITACOES.mudou };
    }
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  revalidatePath(`/p/agenda/${id}`);
  redirect('/p/agenda?ok=pedido-cancelado');
}
