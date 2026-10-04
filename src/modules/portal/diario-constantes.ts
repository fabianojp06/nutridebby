/** US-042 / RN-07. Sem banco: o formulário (cliente) também usa. */
export const REFEICOES_DO_DIARIO = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outro'] as const;
export type RefeicaoDiario = (typeof REFEICOES_DO_DIARIO)[number];
export const FOTO_DIARIO_MAX_BYTES = 10 * 1024 * 1024; // RN-07
export const LIMITE_DIARIO_POR_DIA = 10; // RN-07
export const TEXTO_DIARIO_MAX = 2000;
export const COMENTARIO_MAX = 1000; // US-043 (Tarefa 8)

export const MSG_DIARIO = {
  refeicao: 'Escolha a refeição.',
  vazio: 'Escreva o que você comeu ou envie uma foto.',
  texto: 'Use no máximo 2000 caracteres.',
  foto: 'Envie uma foto JPEG, PNG ou HEIC de até 10 MB',
  limite: 'Limite de 10 registros por dia atingido',
  salvo: 'Registro salvo.',
  salvoSemFoto: 'Registro salvo sem a foto.',
  processando: 'Foto sendo preparada…',
  fotoFalhou: 'Não foi possível processar a foto.',
  nenhum: 'Nenhum registro ainda.',
  ocupado: 'Tente novamente em alguns instantes.',
  formulario: 'Formulário inválido.',
} as const;
