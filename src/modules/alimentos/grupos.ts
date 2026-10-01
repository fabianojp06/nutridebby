/** Os 15 grupos da TACO 4ª ed., na ordem da tabela. "Meu alimento" escolhe um deles (lista de compras, RN-13). */
export const GRUPOS_TACO = [
  'Cereais e derivados',
  'Verduras, hortaliças e derivados',
  'Frutas e derivados',
  'Gorduras e óleos',
  'Pescados e frutos do mar',
  'Carnes e derivados',
  'Leite e derivados',
  'Bebidas (alcoólicas e não alcoólicas)',
  'Ovos e derivados',
  'Produtos açucarados',
  'Miscelâneas',
  'Outros alimentos industrializados',
  'Alimentos preparados',
  'Leguminosas e derivados',
  'Nozes e sementes',
] as const;

export type GrupoAlimento = (typeof GRUPOS_TACO)[number];

export const ehGrupo = (v: unknown): v is GrupoAlimento => typeof v === 'string' && (GRUPOS_TACO as readonly string[]).includes(v);
