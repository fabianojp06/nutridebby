'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { CpfRepetidoError } from '@/modules/pacientes/cadastro';
import { ConvitePacienteError, reenviarConvitePaciente } from '@/modules/pacientes/convite-paciente';
import { EtiquetaError, salvarEtiquetasDoPaciente } from '@/modules/pacientes/etiquetas';
import { arquivarPaciente, desarquivarPaciente } from '@/modules/pacientes/lgpd';
import { atualizarPaciente, criarPaciente, filtroDaUrl, PacienteError, type ErrosPaciente } from '@/modules/pacientes/pacientes';
import { entradaDoFormulario, urlDaLista, valoresDoFormulario, type ValoresPaciente } from './valores';

/**
 * Plano 18 (RN-261): `cpfExistenteId` = o outro paciente do consultório com o mesmo CPF, para o link "Abrir o cadastro
 * existente (abre em nova aba)"; ausente quando o outro está bloqueado (só a mensagem).
 */
export type PacienteState = { erros?: ErrosPaciente; valores?: ValoresPaciente; ok?: boolean; cpfExistenteId?: string };

/** Erro de validação do cadastro → o estado do formulário, com tudo o que foi digitado (PF-N9). */
function comErros(e: PacienteError, valores: ValoresPaciente): PacienteState {
  return e instanceof CpfRepetidoError && e.outroId ? { erros: e.erros, valores, cpfExistenteId: e.outroId } : { erros: e.erros, valores };
}

export async function criarPacienteAction(_prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri('/painel/pacientes/novo');
  const valores = valoresDoFormulario(formData);
  let id: string;
  try {
    id = (await criarPaciente(ctx, tenant, entradaDoFormulario(formData))).id;
  } catch (e) {
    if (e instanceof PacienteError) return comErros(e, valores);
    throw e;
  }
  redirect(`/painel/pacientes/${id}`);
}

/** Plano 18 (D12): o cadastro, o acesso ao app e as etiquetas ficam na aba Perfil — a volta depois do login é para ela. */
export async function atualizarPacienteAction(patientId: string, _prev: PacienteState, formData: FormData): Promise<PacienteState> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/perfil`);
  const valores = valoresDoFormulario(formData);
  try {
    await atualizarPaciente(ctx, tenant, patientId, entradaDoFormulario(formData));
  } catch (e) {
    if (e instanceof PacienteError) return comErros(e, valores);
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return { ok: true };
}

/** O botão só aparece quando reenviar vale; uma recusa aqui é corrida (outra aba) e a página já mostra a situação nova. */
export async function reenviarConviteAction(patientId: string): Promise<void> {
  const { ctx, tenant } = await requireNutri(`/painel/pacientes/${patientId}/perfil`);
  try {
    await reenviarConvitePaciente(ctx, tenant, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof ConvitePacienteError) && !(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/perfil`);
}

export type EtiquetasState = { erro?: string; ok?: boolean };

export async function salvarEtiquetasAction(patientId: string, _prev: EtiquetasState, formData: FormData): Promise<EtiquetasState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/perfil`);
  try {
    await salvarEtiquetasDoPaciente(ctx, patientId, {
      etiquetas: formData.getAll('etiquetas').map(String),
      nova: String(formData.get('nova') ?? ''),
    });
  } catch (e) {
    if (e instanceof EtiquetaError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/perfil`);
  return { ok: true };
}

/**
 * Plano 18 (RN-273, D26): arquivar ou reativar pela lista, com as mesmas funções da aba Privacidade. A volta é para a mesma
 * lista (aba, busca, etiqueta e ordem dos campos ocultos, passados por `filtroDaUrl`; a URL é montada no servidor, nunca
 * lida de um campo) com `ok` e o marcador `r`, que a região de status fixa anuncia. Paciente bloqueado: recusa (nada muda, volta sem `ok`).
 */
async function situacaoPelaLista(formData: FormData, ok: 'arquivado' | 'reativado', fn: typeof arquivarPaciente): Promise<never> {
  const { ctx } = await requireNutri('/painel/pacientes');
  const patientId = String(formData.get('id') ?? '');
  const filtro = filtroDaUrl(Object.fromEntries(['aba', 'busca', 'etiqueta', 'ordem'].map((k) => [k, String(formData.get(k) ?? '')])));
  let feito = true;
  try {
    await fn(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
    feito = false;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  // `r` muda a cada ação: arquivar dois seguidos volta a uma URL diferente e a região de status anuncia de novo (D26)
  redirect(urlDaLista(filtro, feito ? { ok, r: randomUUID().slice(0, 8) } : {}));
}

export async function arquivarDaListaAction(formData: FormData): Promise<void> {
  await situacaoPelaLista(formData, 'arquivado', arquivarPaciente);
}

export async function reativarDaListaAction(formData: FormData): Promise<void> {
  await situacaoPelaLista(formData, 'reativado', desarquivarPaciente);
}
