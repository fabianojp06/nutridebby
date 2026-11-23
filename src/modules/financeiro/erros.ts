import type { TenantContext } from '@/db/tenant';

/**
 * Erros por campo, sempre com os textos de `MSG_FINANCEIRO` — nunca com o que foi digitado (RN-322): a ação devolve à tela
 * o que a pessoa digitou pelos `valores` dela, não pelo erro. Chaves dos lançamentos: `valor`, `categoriaId`, `vencimento`,
 * `pagoEm`, `forma`, `descricao`, `pacienteId`, `motivo`, `geral`; das Configurações: `saldoInicialEm`, `saldoInicial`,
 * `valorConsulta`; das categorias: `nome`, `geral`.
 */
export class FinanceiroError extends Error {
  override name = 'FinanceiroError';
  constructor(readonly erros: Record<string, string>) {
    super('Financeiro: dados recusados');
  }
}

/** RN-301: sem a linha de `fin_configuracoes`, as ações de lançamento levam às Configurações (`?aviso=informeSaldo`). */
export class FinanceiroNaoConfiguradoError extends Error {
  override name = 'FinanceiroNaoConfiguradoError';
  constructor() {
    super('Financeiro não configurado');
  }
}

export class LancamentoNaoEncontradoError extends Error {
  override name = 'LancamentoNaoEncontradoError';
  constructor() {
    super('Lançamento não encontrado');
  }
}

export class CategoriaNaoEncontradaError extends Error {
  override name = 'CategoriaNaoEncontradaError';
  constructor() {
    super('Categoria não encontrada');
  }
}

/**
 * RN-300 (§4.2): só a sessão `nutri`. Conferido antes de abrir a transação: numa sessão de paciente, o `staff_only`
 * devolveria vazio em silêncio, e a tela mostraria "nenhum lançamento" em vez de um erro.
 */
export function exigirNutri(ctx: TenantContext): void {
  if (ctx.role !== 'nutri') throw new Error('financeiro: só a sessão nutri');
}
