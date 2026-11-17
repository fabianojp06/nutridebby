'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  arquivarCategoria,
  criarCategoria,
  excluirCategoria,
  reativarCategoria,
  renomearCategoria,
  salvarConfiguracoes,
} from '@/modules/financeiro/configuracoes';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { CategoriaNaoEncontradaError, FinanceiroError, FinanceiroNaoConfiguradoError } from '@/modules/financeiro/erros';

const CAMINHO = '/painel/financeiro/configuracoes';
const CAMPOS = ['saldoInicialEm', 'saldoInicial', 'valorConsulta'] as const;
export type CampoDaConfiguracao = (typeof CAMPOS)[number];

/** Erro: os erros por campo e o que foi digitado (`valores`); `envio` muda a cada resposta e remonta o formulário (`key`). */
export type ConfiguracaoState = { erros?: Record<string, string>; valores?: Record<CampoDaConfiguracao, string>; envio?: number };
export type CategoriaFeita = 'criada' | 'renomeada' | 'arquivada' | 'reativada' | 'excluida';
export type CategoriaState = { erros?: Record<string, string>; valores?: { nome: string }; envio?: number; feito?: CategoriaFeita };

const texto = (fd: FormData, campo: string) => {
  const v = fd.get(campo);
  return typeof v === 'string' ? v : '';
};
/** Sempre diferente do envio anterior, mesmo duas respostas no mesmo milissegundo. */
const proximoEnvio = (prev: { envio?: number }) => Math.max(Date.now(), (prev.envio ?? 0) + 1);
/** Saldo, valor da consulta e categorias aparecem no Resumo e nos formulários de todo o Financeiro. */
const revalidar = () => revalidatePath('/painel/financeiro', 'layout');

/** US-300. O consultório e a usuária são os da sessão (nunca do formulário); salvou → `?ok=config` (foco no h1, §7). */
export async function salvarConfiguracoesAction(prev: ConfiguracaoState, fd: FormData): Promise<ConfiguracaoState> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, texto(fd, c)])) as Record<CampoDaConfiguracao, string>;
  try {
    await salvarConfiguracoes(ctx, tenant, valores);
  } catch (e) {
    if (e instanceof FinanceiroError) return { erros: e.erros, valores, envio: proximoEnvio(prev) };
    throw e;
  }
  revalidar();
  redirect(`${CAMINHO}?ok=config`);
}

/** "Nova categoria" (RN-303) no tipo da lista. */
export async function novaCategoriaAction(prev: CategoriaState, fd: FormData): Promise<CategoriaState> {
  const { ctx } = await requireNutri(CAMINHO);
  const nome = texto(fd, 'nome');
  try {
    await criarCategoria(ctx, { tipo: texto(fd, 'tipo'), nome });
  } catch (e) {
    if (e instanceof FinanceiroError) return { erros: e.erros, valores: { nome }, envio: proximoEnvio(prev) };
    if (e instanceof FinanceiroNaoConfiguradoError) return { erros: { geral: MSG_FINANCEIRO.informeSaldo }, valores: { nome }, envio: proximoEnvio(prev) };
    throw e;
  }
  revalidar();
  return { feito: 'criada', envio: proximoEnvio(prev) };
}

const ACOES = {
  renomear: { feito: 'renomeada', fazer: renomearCategoria },
  arquivar: { feito: 'arquivada', fazer: (ctx, id) => arquivarCategoria(ctx, id) },
  reativar: { feito: 'reativada', fazer: (ctx, id) => reativarCategoria(ctx, id) },
  excluir: { feito: 'excluida', fazer: (ctx, id) => excluirCategoria(ctx, id) },
} satisfies Record<string, { feito: CategoriaFeita; fazer: (ctx: Parameters<typeof renomearCategoria>[0], id: string, nome: string) => Promise<void> }>;

/**
 * A linha da categoria: "Renomear", "Arquivar", "Reativar" e "Excluir". As recusas do módulo (nome repetido, "Consultas"
 * fixa, categoria com lançamentos) voltam como erro da linha; categoria que não é do consultório (RLS) → 404.
 */
export async function categoriaAction(prev: CategoriaState, fd: FormData): Promise<CategoriaState> {
  const { ctx } = await requireNutri(CAMINHO);
  const acao = texto(fd, 'acao');
  if (!Object.hasOwn(ACOES, acao)) notFound();
  const { feito, fazer } = ACOES[acao as keyof typeof ACOES];
  const nome = texto(fd, 'nome');
  try {
    await fazer(ctx, texto(fd, 'id'), nome);
  } catch (e) {
    if (e instanceof FinanceiroError) return { erros: e.erros, valores: { nome }, envio: proximoEnvio(prev) };
    if (e instanceof CategoriaNaoEncontradaError) notFound();
    throw e;
  }
  revalidar();
  return { feito, envio: proximoEnvio(prev) };
}
