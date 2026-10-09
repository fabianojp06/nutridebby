'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { aplicarSugestao, ConferenciaError, descartarSugestao } from '@/modules/ia/conferencia';
import { configIA } from '@/modules/ia/modo';
import { pedirLeituraExame, PedidoIaError } from '@/modules/ia/tarefas';
import { MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { excluirExame } from '@/modules/pacientes/exames';

export async function excluirExameAction(patientId: string, id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  try {
    await excluirExame(ctx, patientId, id);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}

export type PedidoState = { erro?: string };

/** US-110: "Ler valores com IA". */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura do useActionState
export async function pedirLeituraAction(patientId: string, examId: string, _prev: PedidoState, _fd: FormData): Promise<PedidoState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  try {
    await pedirLeituraExame(ctx, tenant, patientId, examId, { ia: configIA(getEnv()) });
  } catch (e) {
    if (e instanceof PedidoIaError) return { erro: e.mensagem };
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_BLOQUEADO };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/exames`);
  return {};
}

export type ConferenciaState = { erros?: Record<string, string> };

/** US-111: "Salvar valores selecionados" — só as linhas marcadas (`sel`), com os campos editados. */
export async function aplicarSugestaoAction(patientId: string, tarefaId: string, _prev: ConferenciaState, fd: FormData): Promise<ConferenciaState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  const linhas = fd.getAll('sel').map((v) => {
    const i = Number(v);
    return { indice: i, nome: fd.get(`nome-${i}`), valor: fd.get(`valor-${i}`), unidade: fd.get(`unidade-${i}`), referencia: fd.get(`referencia-${i}`) };
  });
  try {
    await aplicarSugestao(ctx, tenant, patientId, tarefaId, { linhas, usarData: fd.get('usarData') === '1' }, { destino: configIA(getEnv()).destino });
  } catch (e) {
    if (e instanceof ConferenciaError) return { erros: e.erros };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: MSG_BLOQUEADO } };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  redirect(`/painel/pacientes/${patientId}/exames?ia=salvo`);
}

/** US-111: "Descartar sugestão". */
export async function descartarSugestaoAction(patientId: string, tarefaId: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/exames`);
  await descartarSugestao(ctx, patientId, tarefaId);
  revalidatePath(`/painel/pacientes/${patientId}/exames`);
  redirect(`/painel/pacientes/${patientId}/exames`);
}
