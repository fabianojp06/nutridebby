'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { CpfRepetidoError } from '@/modules/pacientes/cadastro';
import { ConvitePacienteError, reenviarConvitePaciente } from '@/modules/pacientes/convite-paciente';
import { EtiquetaError, salvarEtiquetasDoPaciente } from '@/modules/pacientes/etiquetas';
import { atualizarPaciente, criarPaciente, PacienteError, type ErrosPaciente } from '@/modules/pacientes/pacientes';
import { entradaDoFormulario, valoresDoFormulario, type ValoresPaciente } from './valores';

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
