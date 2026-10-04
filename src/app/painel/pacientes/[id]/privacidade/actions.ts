'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { logger } from '@/lib/logger';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import {
  apagarFotosDoDiario,
  arquivarPaciente,
  atenderPedidoExclusao,
  desarquivarPaciente,
  LgpdError,
} from '@/modules/pacientes/lgpd';
import { ExportacaoIndisponivelError, solicitarExportacao } from '@/modules/pacientes/exportacao';
import { motivoDoErro } from '@/modules/plataforma/armazenamento';

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
  // US-018 "fotos do diário … apagadas na hora": arquivo fora da transação do atendimento; uma falha aqui só vai
  // para o log (sem caminho — RNF-11): o job exclusao-atendida tenta de novo antes do e-mail ao paciente (F-13) e o
  // job diário de retenção repete para quem está bloqueado
  try {
    await apagarFotosDoDiario(ctx, patientId);
  } catch (err) {
    logger.error({ motivo: motivoDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar fotos do diário no atendimento da exclusão');
  }
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
