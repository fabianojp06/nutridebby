export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Texto digitado: sem espaços nas pontas e com um espaço só entre palavras. Não-texto → ''. */
export const normalizarTexto = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** Tamanho em caracteres como o `char_length` do Postgres conta (code points): um emoji conta 1, não 2 unidades UTF-16. */
export const caracteres = (s: string): number => [...s].length;

/**
 * `maxLength` de um campo cujo limite o servidor confere por `caracteres` (SUS-114): o navegador conta unidades UTF-16 e
 * um caractere ocupa no máximo 2, então o dobro nunca barra um texto que cabe no limite; acima dele, vale a mensagem do
 * servidor. A caixa continua com um teto (nada de colar um texto sem fim).
 */
export const maxLengthPorCaracteres = (limite: number): number => 2 * limite;
