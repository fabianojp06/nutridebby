'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import type { TenantContext } from '@/db/tenant';
import { requireNutri } from '@/lib/tenant-session';
import { cancelarDocumento } from '@/modules/documentos/cancelamento';
import { apagarRascunho, criarParecer, criarReceita, pedirNovoPdfDocumento, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita, voltarAEditar } from '@/modules/documentos/documentos';
import { reenviarLink } from '@/modules/documentos/entrega';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { PerfilIncompletoError } from '@/modules/documentos/perfil-profissional';
import { marcarEntreguePessoalmente } from '@/modules/documentos/recebimento';
import { retificarDocumento } from '@/modules/documentos/retificacao';
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

/** US-142 / US-141: "Nova receita" e "Novo parecer nutricional" abrem o rascunho; bloqueado volta à lista com o aviso. */
async function criarDocumentoAction(patientId: string, criar: (ctx: TenantContext, patientId: string) => Promise<string>): Promise<void> {
  const { ctx } = await acesso(caminho(patientId));
  let id: string;
  try {
    id = await criar(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof PacienteBloqueadoError) redirect(`${caminho(patientId)}?bloqueado=1`);
    throw e;
  }
  redirect(caminho(patientId, id));
}

export async function criarReceitaAction(patientId: string): Promise<void> {
  await criarDocumentoAction(patientId, (ctx, p) => criarReceita(ctx, p));
}

export async function criarParecerAction(patientId: string): Promise<void> {
  await criarDocumentoAction(patientId, (ctx, p) => criarParecer(ctx, p));
}

/** O editor manda os itens e as orientações num campo só (JSON), a justificativa à parte (D15 da spec) e, numa retificação, o motivo (Q13-1 ★). */
function lerEditor(f: FormData): { conteudo: unknown; justificativa: unknown; motivoRetificacao: unknown } | null {
  try {
    // ausente (versão 1: o campo não existe) = undefined, para o módulo não tocar no motivo
    return { conteudo: JSON.parse(String(f.get('conteudo') ?? '{}')), justificativa: f.get('justificativa'), motivoRetificacao: f.has('motivoRetificacao') ? f.get('motivoRetificacao') : undefined };
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

/** US-141 "Rascunho salvo." do parecer: o editor manda a seleção e os textos num campo só (JSON), como o da receita. */
export async function salvarParecerAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoParecer(ctx, patientId, docId, { conteudo: editor.conteudo, motivoRetificacao: editor.motivoRetificacao });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/** US-141 + US-143: "Preparar para assinatura" do parecer grava o que está na tela (a cópia dos exames é refeita) e prepara. */
export async function prepararParecerAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoParecer(ctx, patientId, docId, { conteudo: editor.conteudo, motivoRetificacao: editor.motivoRetificacao });
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

/** D3 a: "Entregue pessoalmente" (o recibo é da nutricionista); como as ações de botão acima, o erro volta ao formulário. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function entreguePessoalmenteAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await marcarEntreguePessoalmente(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/** D6 ★: "Reenviar link por e-mail"; "Link reenviado." (`?link=1`) só sai quando deu certo. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function reenviarLinkAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await reenviarLink(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  redirect(`${caminho(patientId, docId)}?link=1`);
}

/** US-149 / RN-147: "Cancelar documento" com o motivo (fica só no prontuário); o erro de campo volta ao formulário. */
export async function cancelarAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await cancelarDocumento(ctx, patientId, docId, f.get('motivo'));
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/** US-148: "Retificar" abre a versão nova — ou a retificação que já está em andamento (uma por vez). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function retificarAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  let id: string;
  try {
    id = await retificarDocumento(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  redirect(caminho(patientId, id));
}
