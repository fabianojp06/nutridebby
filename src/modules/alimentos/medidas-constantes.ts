import { arredondar, casasDecimais, formatarDecimal } from '@/lib/numero';

export const MSG_MEDIDA = {
  nome: 'Informe o nome da medida e o plural',
  gramas: 'Gramas da medida devem estar entre 0,1 e 5000',
  duplicada: 'Você já tem uma medida com esse nome para este alimento.',
  alimento: 'Alimento não encontrado.',
} as const;

/** Quantidade de medidas aceita num item (ex.: 4 colheres). */
export const QTD_MEDIDA_MAX = 100;

const qtdTexto = (qtd: number) => formatarDecimal(qtd, casasDecimais(arredondar(qtd, 2)));

/** D5: "4 colheres de sopa cheias"; singular abaixo de 2 ("1,5 colher de sopa cheia"). */
export const textoMedida = (qtd: number, m: { nome: string; plural: string }): string => `${qtdTexto(qtd)} ${qtd < 2 ? m.nome : m.plural}`;

/** Gramas da medida na tela (RNF-12): "12,5 g", "12,25 g", "30 g" — as casas que a medida tem (até 2, numeric(7,2)). */
export const gramasDaMedidaTexto = (gramas: number): string => `${formatarDecimal(gramas, casasDecimais(gramas))} g`;

/** quantidade_g do item = medidas × gramas da medida, com 2 casas (coluna numeric(7,2)). */
export const gramasDaMedida = (qtd: number, gramas: number): number => arredondar(qtd * gramas, 2);
