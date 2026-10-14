import type { UsoIA } from './constantes';

/**
 * Plano 14B (F2 do parecer JUR-2026-013, item 3.2 (ii); spec §5.4, RN-115, RN-120; D8): o CONTRATO do que sai para a IA
 * no resumo e no rascunho. A montagem (resumo-dados.ts, rascunho-dados.ts) devolve um objeto cujas chaves de topo são
 * exatamente estas categorias; o teste campos-enviados.test.ts confere a montagem contra este contrato, e o
 * textos-legais.test.ts confere que cada categoria tem a sua frase no texto da autorização. Mudou o que sai → muda aqui →
 * o texto tem de mudar → versão nova da autorização (RN-109).
 */
export const CATEGORIAS = ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas', 'metas'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const CATEGORIAS_POR_USO: Record<Exclude<UsoIA, 'leitura_laudos'>, readonly Categoria[]> = {
  resumo_historico: ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas'],
  rascunho_plano: ['idade', 'sexo', 'anamnese', 'metas'],
};

/** A frase de cada categoria no texto da autorização 1.1 (parágrafo "O que é enviado"). */
export const FRASE_DA_CATEGORIA: Record<Categoria, string> = {
  idade: 'a sua idade',
  sexo: 'o seu sexo',
  medidas: 'medidas',
  gasto: 'cálculos de gasto energético',
  exames: 'exames',
  anamnese: 'anamnese',
  orientacoes: 'orientações',
  plano: 'plano',
  diario: 'diário alimentar sem as fotos',
  notas: 'as anotações dela',
  metas: 'as metas e as preferências que a nutricionista informar',
};
