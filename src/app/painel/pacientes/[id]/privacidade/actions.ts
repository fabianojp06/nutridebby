'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import {
  arquivarPaciente,
  atenderPedidoExclusao,
  desarquivarPaciente,
  LgpdError,
} from '@/modules/pacientes/lgpd';
import { definirRecusaIa, enviarAvisoPorEmail, registrarEntregaEmMaos } from '@/modules/ia/ciencia-paciente';
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

/** US-104 "Enviar aviso por e-mail" (D5: a ciência entra no pós-envio do worker). */
export async function enviarAvisoIaAction(patientId: string): Promise<void> {
  const { ctx, tenant } = await requireNutri(caminho(patientId));
  try {
    await enviarAvisoPorEmail(ctx, tenant, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
    redirect(caminho(patientId)); // bloqueado: a ação não acontece, a página mostra o bloqueio
  }
  redirect(`${caminho(patientId)}?ia=enviado`);
}

/** US-104 "Entreguei o aviso ao paciente". */
export async function registrarEntregaIaAction(patientId: string): Promise<void> {
  await situacao(patientId, (ctx) => registrarEntregaEmMaos(ctx, patientId));
}

/** US-103 "Não usar IA com os dados deste paciente" / "Voltar a usar IA com este paciente". */
export async function recusaIaAction(patientId: string, recusar: boolean): Promise<void> {
  await situacao(patientId, (ctx) => definirRecusaIa(ctx, patientId, recusar));
}
