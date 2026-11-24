'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { novoMarcador } from '@/app/painel/exames/valores';
import { requireNutri } from '@/lib/tenant-session';
import { apagarNota, NotaError, salvarNota } from '@/modules/exames/interpretacao';
import { MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { excluirExame } from '@/modules/pacientes/exames';

/**
 * Plano 22 (T5a, US-373, RN-383): as actions do detalhe do exame. Erro devolve `valores` (o texto digitado volta ao campo)
 * e `envio` (o formulário remonta com ele); salvo ou apagado → o detalhe de novo com `?nota=…&r=…` (a região de status
 * anuncia e o foco vai ao título). O texto da nota nunca vai a log (RNF-370).
 */
export type NotaState = { erros?: Record<string, string>; valores?: { texto: string }; envio?: number };

const detalhe = (patientId: string, exameId: string) => `/painel/pacientes/${patientId}/exames/${exameId}`;

async function comNota(patientId: string, exameId: string, texto: string, gravar: () => Promise<void>, retorno: 'salva' | 'apagada'): Promise<NotaState> {
  try {
    await gravar();
  } catch (e) {
    if (e instanceof NotaError) return { erros: e.erros, valores: { texto }, envio: Date.now() };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: MSG_BLOQUEADO }, valores: { texto }, envio: Date.now() };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  redirect(`${detalhe(patientId, exameId)}?nota=${retorno}&r=${novoMarcador()}`);
}

/** "Salvar nota": uma versão nova com o texto do campo `texto`. */
export async function salvarNotaAction(patientId: string, exameId: string, _prev: NotaState, f: FormData): Promise<NotaState> {
  const { ctx } = await requireNutri(detalhe(patientId, exameId));
  const bruto = f.get('texto');
  const texto = typeof bruto === 'string' ? bruto : '';
  return comNota(patientId, exameId, texto, () => salvarNota(ctx, patientId, exameId, texto), 'salva');
}

/** "Apagar nota": uma versão nova com o texto nulo (e o `excluir` de `exames_nota` no Histórico). */
export async function apagarNotaAction(patientId: string, exameId: string, _prev: NotaState, f: FormData): Promise<NotaState> {
  const { ctx } = await requireNutri(detalhe(patientId, exameId));
  const bruto = f.get('texto');
  return comNota(patientId, exameId, typeof bruto === 'string' ? bruto : '', () => apagarNota(ctx, patientId, exameId), 'apagada');
}

/** "Excluir" no detalhe (a confirmação no `DialogoConfirmar`): o exame e o laudo saem, e a tela volta à aba Exames. */
export async function excluirExameDoDetalheAction(patientId: string, exameId: string): Promise<void> {
  const { ctx } = await requireNutri(detalhe(patientId, exameId));
  try {
    await excluirExame(ctx, patientId, exameId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  redirect(`/painel/pacientes/${patientId}/exames`);
}
