'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { aplicarSugestao, ConferenciaError, descartarSugestao } from '@/modules/ia/conferencia';
import { editarExame, type LinhaEditada } from '@/modules/exames/edicao';
import { configIA } from '@/modules/ia/modo';
import { pedirLeituraExame, PedidoIaError } from '@/modules/ia/tarefas';
import { MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { ExameError, excluirExame } from '@/modules/pacientes/exames';

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

export type EditarState = { erros?: Record<string, string>; valores?: Record<string, unknown>; envio?: number };

const textoDo = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

/** As linhas que o formulário manda em JSON: só os campos da linha e o índice `origem` (nunca o `iaTarefaId`). */
function linhasDoFormulario(f: FormData): LinhaEditada[] | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(textoDo(f, 'linhas') || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(bruto)) return null;
  return bruto.map((l) => {
    const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    return {
      origem: typeof o.origem === 'number' ? o.origem : null,
      nome: o.nome,
      valor: o.valor,
      unidade: o.unidade,
      referencia: o.referencia,
      refMin: o.refMin,
      refMax: o.refMax,
    };
  });
}

/**
 * Plano 22 (T4, US-371, RN-378): "Editar exame" — sem arquivo (o laudo não muda, EP-D44), por isso Server Action. Erro
 * devolve `valores` (título, data e justificativa voltam aos campos; as linhas ficam no estado do formulário). Salvo →
 * de volta à aba Exames com "Exame salvo.", o foco no título do exame.
 */
export async function editarExameAction(patientId: string, exameId: string, _prev: EditarState, f: FormData): Promise<EditarState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/exames/${exameId}/editar`);
  const valores = { titulo: textoDo(f, 'titulo'), data: textoDo(f, 'data'), justificativa: textoDo(f, 'justificativa') };
  const linhas = linhasDoFormulario(f);
  try {
    await editarExame(ctx, tenant, patientId, exameId, { ...valores, linhas: linhas ?? (null as unknown as LinhaEditada[]), lidoEm: textoDo(f, 'lidoEm') });
  } catch (e) {
    if (e instanceof ExameError) return { erros: e.erros, valores, envio: Date.now() };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: MSG_BLOQUEADO }, valores, envio: Date.now() };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  // "Exame salvo." aparece no próprio exame editado (não no topo, longe do foco) e recebe o foco pela âncora
  redirect(`/painel/pacientes/${patientId}/exames?editado=${exameId}#exame-salvo`);
}

