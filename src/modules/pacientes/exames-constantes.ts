/** Limite e mensagens de exame que o formulário (navegador) também usa. */
export const EXAME_MAX_BYTES = 20 * 1024 * 1024; // US-015

export const MSG_EXAME = {
  arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB',
  titulo: 'Informe o título do exame',
  data: 'Informe a data do exame',
  futuro: 'A data não pode ser no futuro',
  valores: 'Confira os valores: informe nome e valor numérico',
  ocupado: 'Tente novamente em alguns instantes.', // mesmo texto do logo ocupado (Plano 02)
} as const;
