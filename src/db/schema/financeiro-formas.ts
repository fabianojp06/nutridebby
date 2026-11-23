/**
 * Plano 20 (RN-304): fonte única das formas de pagamento — o CHECK de `fin_lancamentos.forma_pagamento` usa esta lista
 * (src/db/schema/financeiro.ts) e o módulo reexporta (src/modules/financeiro/constantes.ts) com os rótulos. Arquivo puro,
 * sem drizzle: os componentes cliente que importam `MSG_FINANCEIRO` não levam o pg-core para o navegador.
 */
export const FORMAS_DE_PAGAMENTO = ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'transferencia', 'boleto', 'outra'] as const;
export type FormaPagamento = (typeof FORMAS_DE_PAGAMENTO)[number];
