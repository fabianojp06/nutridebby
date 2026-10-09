'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { clientIp } from '@/lib/ip';
import { requirePaciente } from '@/lib/paciente-session';
import { AutorizacaoError, autorizarNoApp, retirarNoApp } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { MSG_MEUS_DADOS, pedirExclusao, pedirMeusDados } from '@/modules/portal/meus-dados';
import { MSG_PERFIL, PerfilPacienteError, preferenciaWhatsapp } from '@/modules/portal/perfil';

export type PerfilState = { ok?: string; erro?: string };

/** US-046 "Baixar meus dados" (D16: 1 pedido a cada 24 h). */
export async function meusDadosAction(): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  const r = await pedirMeusDados(ctx);
  if (r === 'limite_falhas') return { erro: MSG_MEUS_DADOS.limiteFalhas };
  return { ok: r === 'pedido' ? MSG_MEUS_DADOS.pedido : MSG_MEUS_DADOS.jaPedido };
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

/** RN-107: IP e user-agent da requisição (prova do ato no app). */
async function origemDaRequisicao() {
  const h = await headers();
  return { ip: clientIp(h, getEnv().TRUSTED_PROXIES), userAgent: h.get('user-agent') };
}

/**
 * US-106 "Autorizo o envio para fora do Brasil" (/p/perfil/ia): grava e volta a Eu, no bloco de IA, com o retorno. `tenantId` = o consultório
 * cujo texto a página mostrou (nome, nutricionista, CRN): se o vínculo aberto mudou entre a leitura e o toque (troca de
 * consultório em outra aba), nada é gravado e Eu mostra a situação do consultório de agora.
 */
export async function autorizarIaAction(tenantId: string): Promise<void> {
  const { ctx } = await requirePaciente('/p/perfil/ia');
  if (ctx.tenantId !== tenantId) redirect('/p/perfil');
  const env = getEnv();
  try {
    await autorizarNoApp(ctx, { ia: configIA(env), appUrl: env.APP_URL, ...(await origemDaRequisicao()) });
  } catch (e) {
    // a IA foi desativada (ou o perfil ficou incompleto) entre a leitura e o toque: Eu mostra a situação de agora
    if (e instanceof AutorizacaoError) redirect('/p/perfil');
    throw e;
  }
  // a âncora do bloco: o retorno fica na vista, não no fim de Eu (revisão da T8)
  redirect('/p/perfil?ia=autorizou#eu-ia');
}

/** US-109 "Retirar autorização" no app: o evento e o job ia-retirada na mesma transação (RN-108). */
export async function retirarIaAction(): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  const r = await retirarNoApp(ctx, await origemDaRequisicao());
  revalidatePath('/p/perfil');
  return r === 'retirada' ? { ok: MSG_AUTORIZACAO.retirada } : {};
}
