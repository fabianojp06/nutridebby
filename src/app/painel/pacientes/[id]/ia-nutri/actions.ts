'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { desativarPelaNutri } from '@/modules/ia/nutri-paciente/consentimento';
import { bloquearPaciente, ConfirmarPesoOcultoError, liberarPaciente } from '@/modules/ia/nutri-paciente/participacao';
import { idValido, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

const aba = (patientId: string) => `/painel/pacientes/${patientId}/ia-nutri`;

/**
 * US-170 "Liberar um paciente" / "Bloquear de novo" (D6): UMA action, decidida pela caixa "Liberar a IA Nutri para este
 * paciente" (marcada → liberar; desmarcada → bloquear). `antes` é o estado em que a tela abriu: sem mudança, nada é gravado.
 * D33: `confirmarPesoOculto` só vem quando a nutricionista confirmou a pergunta do peso oculto ao marcar (ou o paciente já
 * estava liberado); sem ela, o módulo recusa e a tela mostra a pergunta (aba aberta antes de o peso ser ocultado). O
 * consultório e a usuária vêm da sessão; o paciente, da URL (404 fora do consultório).
 */
export async function salvarLiberacaoIaNutriAction(patientId: string, fd: FormData): Promise<void> {
  const { ctx } = await requireNutri(aba(patientId));
  if (!idValido(patientId)) notFound();
  const marcada = fd.get('liberar') === 'on';
  let retorno = 'salvo';
  if (marcada !== (fd.get('antes') === '1')) {
    try {
      if (marcada) await liberarPaciente(ctx, patientId, { confirmarPesoOculto: fd.get('confirmarPesoOculto') === '1' });
      else await bloquearPaciente(ctx, patientId);
    } catch (e) {
      if (e instanceof PacienteNaoEncontradoError) notFound();
      if (e instanceof ConfirmarPesoOcultoError) retorno = 'peso-oculto';
      else if (e instanceof PacienteBloqueadoError) retorno = 'bloqueado';
      else throw e;
    }
  }
  revalidatePath(aba(patientId));
  redirect(`${aba(patientId)}?ia-nutri=${retorno}`);
}

/**
 * DP-17 (LGPD art. 8º, § 5º; art. 18, IX): a desativação a pedido do paciente, registrada pela nutricionista na ficha —
 * alcança o paciente arquivado ou bloqueado, que não entra no app. Canal `nutricionista`, em nome da usuária da sessão.
 */
export async function desativarPelaNutriAction(patientId: string): Promise<void> {
  const { ctx } = await requireNutri(aba(patientId));
  if (!idValido(patientId)) notFound();
  let r: 'desativada' | 'nada_a_desativar';
  try {
    r = await desativarPelaNutri(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(aba(patientId));
  redirect(r === 'desativada' ? `${aba(patientId)}?ia-nutri=desativada` : aba(patientId));
}
