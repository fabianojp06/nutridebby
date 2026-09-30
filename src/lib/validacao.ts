import type { z } from 'zod';

/** Primeira mensagem de cada campo (o formulário mostra uma por campo). */
export function primeiroErroPorCampo(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? 'geral');
    out[campo] ??= issue.message;
  }
  return out;
}
