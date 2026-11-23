'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  convidarRecepcao,
  definirPermissaoFinanceiro,
  desativarRecepcao,
  EquipeError,
  reativarRecepcao,
  reenviarConviteRecepcao,
  type CampoDaEquipe,
} from '@/modules/plataforma/equipe';
import { EQUIPE_LIGADA } from '@/modules/plataforma/equipe-textos';

const CAMINHO = '/painel/configuracoes/equipe';

export type ConvidarState = {
  erros?: Partial<Record<CampoDaEquipe, string>>;
  valores?: { nome: string; email: string; financeiro: boolean };
  /** Um por envio com erro: o formulário volta montado de novo com os valores e o foco no primeiro erro. */
  envio?: string;
};

/**
 * RE-D52: com a Equipe desligada, toda action recusa ANTES de ler a sessão — o `notFound()` da página não fecha um POST
 * direto, e nada é gravado. Ligada, só a nutricionista (RN-499; `requireNutri`, nunca `requireEquipe`).
 */
async function sessaoDaEquipe() {
  if (!EQUIPE_LIGADA) notFound();
  return requireNutri(CAMINHO);
}

/** A volta à tela com o resultado e o marcador `r` (um por ação: a região de aviso anuncia de novo; padrão do Plano 18). */
function voltar(q: Record<string, string>): never {
  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?${new URLSearchParams({ ...q, r: randomUUID().slice(0, 8) })}`);
}

/** US-488 "Convidar": os campos do formulário; o consultório, a usuária e o IP vêm da sessão. */
export async function convidarAction(_prev: ConvidarState, formData: FormData): Promise<ConvidarState> {
  const { ctx } = await sessaoDaEquipe();
  const valores = { nome: String(formData.get('nome') ?? ''), email: String(formData.get('email') ?? ''), financeiro: formData.get('financeiro') === 'on' };
  try {
    await convidarRecepcao(ctx, valores);
  } catch (e) {
    if (e instanceof EquipeError) return { erros: e.erros, valores, envio: randomUUID().slice(0, 8) };
    throw e;
  }
  voltar({ ok: 'convidada' });
}

type Ok = 'reenviado' | 'permissao' | 'desativada' | 'reativada';

/**
 * As ações de uma linha da tabela: a pessoa pelo id do formulário (o módulo confere que é do consultório da sessão). A volta
 * leva `m` (o foco vai para a linha, §7.2); o erro conhecido vai por `?erro=` (lista fechada na página); a pessoa que não
 * existe no consultório dá 404.
 */
async function acaoDaLinha(formData: FormData, ok: Ok, fn: (ctx: Awaited<ReturnType<typeof requireNutri>>['ctx'], id: string) => Promise<void>): Promise<never> {
  const { ctx } = await sessaoDaEquipe();
  const id = String(formData.get('id') ?? '');
  let erro: string | null = null;
  try {
    await fn(ctx, id);
  } catch (e) {
    if (!(e instanceof EquipeError)) throw e;
    if (e.code === 'nao_encontrado') notFound();
    erro = e.code;
  }
  voltar(erro ? { erro, m: id } : { ok, m: id });
}

/** RN-499: "Reenviar convite" (só sem senha criada). */
export async function reenviarAction(formData: FormData): Promise<void> {
  await acaoDaLinha(formData, 'reenviado', (ctx, id) => reenviarConviteRecepcao(ctx, id));
}

/** RN-502: "Salvar permissão" — a caixa "Permitir acesso ao Controle Financeiro" da linha. */
export async function permissaoAction(formData: FormData): Promise<void> {
  const financeiro = formData.get('financeiro') === 'on';
  await acaoDaLinha(formData, 'permissao', (ctx, id) => definirPermissaoFinanceiro(ctx, id, financeiro));
}

/** RN-503: "Desativar" (confirmado no navegador pelo `ConfirmarBotao`). */
export async function desativarAction(formData: FormData): Promise<void> {
  await acaoDaLinha(formData, 'desativada', (ctx, id) => desativarRecepcao(ctx, id));
}

/** RN-503: "Reativar", respeitando o limite de 3 ativas. */
export async function reativarAction(formData: FormData): Promise<void> {
  await acaoDaLinha(formData, 'reativada', (ctx, id) => reativarRecepcao(ctx, id));
}
