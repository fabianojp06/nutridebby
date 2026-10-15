'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { ativarIa, AtivacaoIaError, desativarIa } from '@/modules/ia/ativacao';
import { pedirModelos } from '@/modules/ia/modelos-sugeridos';
import { configIA } from '@/modules/ia/modo';
import { ativarIaNutri, desativarIaNutri, IaNutriError } from '@/modules/ia/nutri-paciente/participacao';
import { PedidoIaError } from '@/modules/ia/tarefas';
import { definirRecebimentoDeExames } from '@/modules/plataforma/recebimento-exames';

export type AtivarIaState = { erro?: string };

/**
 * US-101 "Ativar": a usuária, o consultório e o IP vêm da sessão (requireNutri), nunca do formulário.
 * No sucesso, redirect com `?ia=ativada`: a seção redesenhada troca o formulário pelo ramo "ativa" (outro nó da árvore),
 * então a confirmação "IA ativada." não pode morar no estado do formulário; a página a mostra pelo parâmetro.
 */
export async function ativarIaAction(_prev: AtivarIaState, fd: FormData): Promise<AtivarIaState> {
  const { data, tenant, ctx } = await requireNutri('/painel/configuracoes');
  try {
    await ativarIa({ userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null }, fd.get('aceite') === '1');
  } catch (e) {
    if (e instanceof AtivacaoIaError) return { erro: e.mensagem };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  redirect('/painel/configuracoes?ia=ativada');
}

/** US-101 "Desativar". */
export async function desativarIaAction(): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  await desativarIa(ctx);
  revalidatePath('/painel', 'layout');
}

export type PedirModelosState = { erro?: string };

/**
 * US-123 "Gerar": o consultório e a usuária vêm da sessão; a área do formulário passa pela lista fechada no módulo.
 * No sucesso, redirect: a seção passa a mostrar o andamento (o formulário some), como no "Ativar". A âncora `#modelos-ia`
 * leva a tela até a seção (a última de Configurações) e `?modelos=pedido` põe o foco na confirmação (revisão da T5).
 */
export async function pedirModelosAction(_prev: PedirModelosState, fd: FormData): Promise<PedirModelosState> {
  const { ctx, tenant } = await requireNutri('/painel/configuracoes');
  try {
    await pedirModelos(ctx, tenant, fd.get('area'), { ia: configIA(getEnv()) });
  } catch (e) {
    if (e instanceof PedidoIaError) return { erro: e.mensagem };
    throw e;
  }
  revalidatePath('/painel/configuracoes');
  redirect('/painel/configuracoes?modelos=pedido#modelos-ia');
}

/** D18 = a (Plano 12): liga/desliga o recebimento de exames pelo app. O consultório vem da sessão, nunca do formulário. */
export async function definirRecebimentoAction(fd: FormData): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  await definirRecebimentoDeExames(ctx, fd.get('receberExames') === 'on');
  revalidatePath('/painel', 'layout'); // o menu ("Exames recebidos") depende do recebimento ligado
  redirect('/painel/configuracoes?exames=salvo');
}

/**
 * US-170 "Ligar no consultório": a usuária e o consultório vêm da sessão; sem trava de texto (★ DO-2 trocada, D37). O retorno
 * vai pela URL (`?ia-nutri=`, lista fechada) e aparece dentro da subseção, na região `role="status"` (a âncora leva a ela).
 */
export async function ativarIaNutriAction(): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  try {
    await ativarIaNutri(ctx, { ia: configIA(getEnv()) });
  } catch (e) {
    if (e instanceof IaNutriError) redirect('/painel/configuracoes?ia-nutri=indisponivel#ia-nutri-titulo');
    throw e;
  }
  revalidatePath('/painel', 'layout'); // o menu ("Dúvidas dos pacientes") depende da ativação
  redirect('/painel/configuracoes?ia-nutri=ativada#ia-nutri-titulo');
}

/** US-170 "Desligar no consultório": nenhuma pergunta nova; a fila de dúvidas continua. */
export async function desativarIaNutriAction(): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  await desativarIaNutri(ctx);
  revalidatePath('/painel', 'layout');
  redirect('/painel/configuracoes?ia-nutri=desativada#ia-nutri-titulo');
}
