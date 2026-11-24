/**
 * SUS-109 (regra 3 do CLAUDE.md): caracteres que o Postgres recusa ao gravar texto digitado — o NUL (`\u0000`: 22021 em
 * `text`, 22P05 em `jsonb`) e o surrogate UTF-16 sem par (`\ud800`, `\udc00` sozinhos: 22P02 em `jsonb`; em `text` o
 * driver troca por U+FFFD em silêncio). A mensagem do erro (DETAIL/CONTEXT) leva um trecho do conteúdo ao log do
 * Postgres e ao erro do app — e o conteúdo pode ser dado de saúde. Os pares válidos (emoji) ficam.
 *
 * Módulo neutro e sem imports: o formulário 'use client' e as regras puras (`puros.test.ts`) também importam daqui.
 */
const SURROGATE_SEM_PAR = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Tira o NUL e os surrogates sem par; nenhum outro caractere muda. */
export const semInvalidosNoBanco = (s: string): string => s.replace(/\u0000/g, '').replace(SURROGATE_SEM_PAR, '');
