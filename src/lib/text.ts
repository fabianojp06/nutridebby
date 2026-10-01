export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Texto digitado: sem espaços nas pontas e com um espaço só entre palavras. Não-texto → ''. */
export const normalizarTexto = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
