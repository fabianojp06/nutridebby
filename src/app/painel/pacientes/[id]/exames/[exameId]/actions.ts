'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { novoMarcador } from '@/app/painel/exames/valores';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { mostrarNoApp, retirarDoApp } from '@/modules/exames/edicao';
import { apagarNota, NotaError, salvarNota } from '@/modules/exames/interpretacao';
import { MSG_BLOQUEADO, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { ExameError, excluirExame } from '@/modules/pacientes/exames';

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

/**
 * Plano 22 (T6, US-375, RN-385, R22-17): "Mostrar no app do paciente" e "Retirar do app". A tela fica onde está (sem
 * redirecionar): a ficha é revalidada (o selo "No app" muda) e o resultado volta para a região de status do detalhe.
 * Paciente bloqueado → a recusa de hoje; o exame sumiu (excluído em outra aba) → "Não foi possível mudar o app do
 * paciente. Tente de novo."; paciente de outro consultório → 404.
 */
export type NoAppState = { ok?: true; pacienteUsaApp?: boolean; erro?: string };

async function mudarNoApp(patientId: string, mudar: () => Promise<NoAppState>): Promise<NoAppState> {
  let r: NoAppState;
  try {
    r = await mudar();
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_BLOQUEADO };
    if (e instanceof ExameError) return { erro: MSG_EXAMES.vazios.erroApp };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return r;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a assinatura do useActionState; o estado anterior e o formulário não são usados
export async function mostrarNoAppAction(patientId: string, exameId: string, _prev: NoAppState, _f: FormData): Promise<NoAppState> {
  const { ctx } = await requireNutri(detalhe(patientId, exameId));
  return mudarNoApp(patientId, async () => ({ ok: true, pacienteUsaApp: (await mostrarNoApp(ctx, patientId, exameId)).pacienteUsaApp }));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a assinatura do useActionState; o estado anterior e o formulário não são usados
export async function retirarDoAppAction(patientId: string, exameId: string, _prev: NoAppState, _f: FormData): Promise<NoAppState> {
  const { ctx } = await requireNutri(detalhe(patientId, exameId));
  return mudarNoApp(patientId, async () => {
    await retirarDoApp(ctx, patientId, exameId);
    return { ok: true };
  });
}
