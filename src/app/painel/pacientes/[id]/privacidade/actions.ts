'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { AutorizacaoError, enviarPedidoPorEmail, registrarRetiradaPelaNutri } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import {
  arquivarPaciente,
  atenderPedidoExclusao,
  desarquivarPaciente,
  LgpdError,
} from '@/modules/pacientes/lgpd';
import { ExportacaoIndisponivelError, solicitarExportacao } from '@/modules/pacientes/exportacao';

const caminho = (id: string) => `/painel/pacientes/${id}/privacidade`;

async function situacao(
  patientId: string,
  fn: (ctx: Awaited<ReturnType<typeof requireNutri>>['ctx']) => Promise<void>,
) {
  const { ctx } = await requireNutri(caminho(patientId));
  try {
    await fn(ctx);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}

export async function arquivarAction(patientId: string): Promise<void> {
  await situacao(patientId, (ctx) => arquivarPaciente(ctx, patientId));
}

export async function desarquivarAction(patientId: string): Promise<void> {
  await situacao(patientId, (ctx) => desarquivarPaciente(ctx, patientId));
}

export type ExclusaoState = { erro?: string };

export async function atenderExclusaoAction(
  patientId: string,
  _prev: ExclusaoState,
  formData: FormData,
): Promise<ExclusaoState> {
  const { ctx, tenant } = await requireNutri(caminho(patientId));
  try {
    await atenderPedidoExclusao(ctx, tenant, patientId, String(formData.get('confirmacao') ?? ''));
  } catch (e) {
    if (e instanceof LgpdError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  // US-018 "fotos do diário … apagadas na hora": pelo job exclusao-atendida, que nasce na transação do atendimento e
  // apaga as fotos antes do e-mail ao paciente (F-13, com novas tentativas); o job diário de retenção repete para quem
  // está bloqueado (achado 6 do /code-review: a action não apaga mais em dobro)
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return {};
}

export async function exportarAction(patientId: string): Promise<void> {
  const { ctx } = await requireNutri(caminho(patientId));
  let id: string;
  try {
    id = await solicitarExportacao(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    // Corrida com a anonimização (a página já esconde o botão): volta para a aba, que explica
    if (e instanceof ExportacaoIndisponivelError) redirect(caminho(patientId));
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/exportacoes/${id}`);
}

export type PedidoIaState = { ok?: string; erro?: string };

/** US-105 "Enviar pedido de autorização por e-mail" (o e-mail entra na fila na mesma transação do registro). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura do useActionState
export async function enviarPedidoIaAction(patientId: string, _prev: PedidoIaState, _fd: FormData): Promise<PedidoIaState> {
  const { ctx } = await requireNutri(caminho(patientId));
  try {
    const env = getEnv();
    await enviarPedidoPorEmail(ctx, patientId, { ia: configIA(env), appUrl: env.APP_URL });
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof AutorizacaoError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return { ok: MSG_AUTORIZACAO.pedidoEnviado };
}

/** US-109 "Registrar retirada a pedido do paciente": a retirada e o cancelamento na mesma transação (RN-108). */
export async function retiradaIaAction(patientId: string): Promise<void> {
  await situacao(patientId, async (ctx) => {
    await registrarRetiradaPelaNutri(ctx, patientId);
  });
}
