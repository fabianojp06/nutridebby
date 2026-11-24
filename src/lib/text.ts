import { semInvalidosNoBanco } from './texto-seguro';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Texto digitado: sem espaços nas pontas e com um espaço só entre palavras. Não-texto → ''.
 * SUS-110 (regra 3): antes de tudo, o NUL vira espaço ("Ana\u0000Souza" → "Ana Souza": separa palavras, como os outros
 * controles que `\s` junta) e o surrogate sem par sai (`semInvalidosNoBanco`) — o Postgres recusaria os dois com um trecho
 * do texto no log e no erro. Quem corta o resultado (`.slice`) limpa de novo: o corte pode deixar meio emoji no fim.
 */
export const normalizarTexto = (v: unknown): string =>
  typeof v === 'string' ? semInvalidosNoBanco(v.replace(/\u0000/g, ' ')).trim().replace(/\s+/g, ' ') : '';
