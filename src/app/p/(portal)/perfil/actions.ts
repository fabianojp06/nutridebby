'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_MEUS_DADOS, pedirExclusao, pedirMeusDados } from '@/modules/portal/meus-dados';
import { MSG_PERFIL, PerfilPacienteError, preferenciaWhatsapp } from '@/modules/portal/perfil';

export type PerfilState = { ok?: string; erro?: string };

/** US-046 "Baixar meus dados" (D16: 1 pedido a cada 24 h). */
export async function meusDadosAction(): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  return { ok: (await pedirMeusDados(ctx)) === 'pedido' ? MSG_MEUS_DADOS.pedido : MSG_MEUS_DADOS.jaPedido };
}

/** US-046 "Pedir exclusão dos meus dados" (D17: um pedido aberto por vez). */
export async function exclusaoAction(): Promise<PerfilState> {
  const { ctx, tenant } = await requirePaciente('/p/perfil');
  const r = await pedirExclusao(ctx, tenant);
  // L-1: o vínculo deixou de ser ativo entre a entrada e a trava — o Perfil recarrega e requirePaciente leva a
  // /p/sem-acesso (ou à escolha do consultório, com outro vínculo)
  if ('semAcesso' in r) redirect('/p/perfil');
  return { ok: 'registrado' in r ? MSG_MEUS_DADOS.exclusaoRegistrada : MSG_MEUS_DADOS.exclusaoJaPedida(r.jaPedidoEm) };
}

/** US-011 "Revogar o WhatsApp" (D20): desmarcar = opt-out; marcar exige telefone no cadastro. */
export async function whatsappAction(_: PerfilState, formData: FormData): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  try {
    await preferenciaWhatsapp(ctx, formData.get('whatsapp') === 'on');
  } catch (e) {
    if (e instanceof PerfilPacienteError) return { erro: e.message };
    throw e;
  }
  revalidatePath('/p/perfil');
  return { ok: MSG_PERFIL.salvo };
}
