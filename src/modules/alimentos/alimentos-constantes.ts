export const KCAL_MAX = 900;
export const GRAMAS_MAX = 100;

export const MSG_ALIMENTO = {
  nome: 'Informe o nome do alimento (2 a 120 caracteres)',
  grupo: 'Escolha o grupo do alimento',
  valores: 'Valores por 100 g: energia entre 0 e 900 kcal; os demais entre 0 e 100 g', // KCAL_MAX e GRAMAS_MAX
  taco: 'Alimentos da TACO não podem ser alterados. Use "Duplicar como meu alimento".',
  emUso: 'Este alimento está em um plano e não pode ser excluído.',
  naoEncontrado: 'Alimento não encontrado.',
  incompleto: 'A TACO não tem todos os valores deste alimento: confira os campos com 0.',
} as const;
