'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { apagarRascunho, criarReceita, pedirNovoPdfDocumento, prepararParaAssinatura, salvarRascunhoReceita, voltarAEditar } from '@/modules/documentos/documentos';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { PerfilIncompletoError } from '@/modules/documentos/perfil-profissional';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type EstadoForm = { erros?: Record<string, string>; ok?: boolean; perfilIncompleto?: boolean };

const caminho = (patientId: string, docId?: string) => `/painel/pacientes/${patientId}/documentos${docId ? `/${docId}` : ''}`;

/** D20: sem a liberação, as ações não existem (404), como a aba. */
async function acesso(path: string) {
  const a = await requireNutri(path);
  if (!a.tenant.documentosLiberados) notFound();
  return a;
}

function comoEstado(e: unknown): EstadoForm {
  if (e instanceof DocumentoError) return { erros: e.erros };
  if (e instanceof PerfilIncompletoError) return { erros: { geral: e.message }, perfilIncompleto: true };
  if (e instanceof TransicaoInvalidaError || e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
  if (e instanceof DocumentoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function criarReceitaAction(patientId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId));
  let id: string;
  try {
    id = await criarReceita(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof PacienteBloqueadoError) redirect(`${caminho(patientId)}?bloqueado=1`);
    throw e;
  }
  redirect(caminho(patientId, id));
}

/** O editor manda os itens e as orientações num campo só (JSON), e a justificativa à parte (D15 da spec). */
function lerEditor(f: FormData): { conteudo: unknown; justificativa: unknown } | null {
  try {
    return { conteudo: JSON.parse(String(f.get('conteudo') ?? '{}')), justificativa: f.get('justificativa') };
  } catch {
    return null;
  }
}

export async function salvarRascunhoAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoReceita(ctx, tenant, patientId, docId, editor);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/**
 * As ações de botão (AcaoDocumento, useActionState): o erro VOLTA ao formulário (role="alert") e o sinal de sucesso —
 * "?apagado=1", a página revalidada — só sai quando deu certo (correção do /code-review high do PR #18: antes, o retorno
 * de comoEstado era ignorado e a tela dizia "Rascunho apagado." com o documento ainda lá).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function apagarRascunhoAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await apagarRascunho(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  redirect(`${caminho(patientId)}?apagado=1`);
}

/**
 * "Preparar para assinatura" prepara o que está na tela (revisão da T6): o preparo é um botão do formulário do editor, que
 * manda os itens e a justificativa junto com a declaração; grava como o "Salvar rascunho" e prepara em seguida. Erro de
 * campo: volta ao editor e nada é gravado. Erro do preparo (declaração, perfil, justificativa vazia): volta ao editor, e o
 * que estava na tela já ficou salvo — nos dois casos, o documento continua rascunho.
 */
export async function prepararAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoReceita(ctx, tenant, patientId, docId, editor);
    await prepararParaAssinatura(ctx, tenant, patientId, docId, { declaracao: f.get('declaracao') });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function voltarAEditarAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await voltarAEditar(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function pedirNovoPdfAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await pedirNovoPdfDocumento(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId, docId));
  return { ok: true };
}
