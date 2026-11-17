import { FONTES, type FontePublica } from './fontes';

/** D6 (Plano 19): o teto subiu de 900 para 1000 kcal por 100 g (gorduras da SR Legacy chegam a 902), como o CHECK foods_valores_faixa. */
export const KCAL_MAX = 1000;
export const GRAMAS_MAX = 100;

export const MSG_ALIMENTO = {
  nome: 'Informe o nome do alimento (2 a 120 caracteres)',
  grupo: 'Escolha o grupo do alimento',
  valores: 'Valores por 100 g: energia entre 0 e 1000 kcal; os demais entre 0 e 100 g', // KCAL_MAX e GRAMAS_MAX
  /** RN-230: vale para toda tabela pública (`fonte <> 'propria'`). */
  taco: 'Alimentos de tabelas públicas (TACO, USDA) não podem ser alterados. Use "Duplicar como meu alimento".',
  /** D12 (Plano 07): a FK RESTRICT de `meal_items` e a de `recipe_ingredients` caem no mesmo `fkViolation`. */
  emUso: 'Este alimento está em um plano ou receita e não pode ser excluído.',
  naoEncontrado: 'Alimento não encontrado.',
  /** RN-230: "Duplicar como meu alimento" de um alimento sem algum dos 5 valores, pela sigla da tabela de origem. */
  incompleto: (f: FontePublica) => `A ${FONTES[f].sigla} não tem todos os valores deste alimento: confira os campos com 0.`,
} as const;
