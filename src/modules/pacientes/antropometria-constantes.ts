/**
 * PF-B1/F8: constantes sem nenhum import, para o formulário `'use client'` da antropometria
 * importá-las sem puxar `antropometria.ts` (pg, env, auditoria) para o navegador.
 */

export const CIRCUNFERENCIAS = [
  { id: 'braco', rotulo: 'Braço' },
  { id: 'cintura', rotulo: 'Cintura' },
  { id: 'abdome', rotulo: 'Abdome' },
  { id: 'quadril', rotulo: 'Quadril' },
  { id: 'coxa', rotulo: 'Coxa' },
  { id: 'panturrilha', rotulo: 'Panturrilha' },
] as const;
export type CircunferenciaId = (typeof CIRCUNFERENCIAS)[number]['id'];

export const MSG_ANTROPO = {
  data: 'Informe a data da avaliação',
  futuro: 'A data não pode ser no futuro',
  antesDoNascimento: 'A data não pode ser anterior à data de nascimento',
  peso: 'Peso deve estar entre 1 e 400 kg',
  altura: 'Altura deve estar entre 30 e 250 cm',
  circunferencia: 'Circunferência deve estar entre 5 e 300 cm',
  dobra: 'Dobra deve estar entre 1 e 100 mm',
  dobrasFaltando: (n: number) => `Preencha as ${n} dobras para calcular o % de gordura`,
} as const;
