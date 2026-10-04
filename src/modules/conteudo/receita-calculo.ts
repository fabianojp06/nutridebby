import { arredondar } from '@/lib/numero';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { gTexto, kcalTexto, nutrientesDoItem, ZERO, type Nutrientes } from '@/modules/plano-alimentar/calculo';

/** RN-11. Sem banco e sem React: o formulário (cliente), o painel e o portal usam a mesma conta. */
export type IngredienteCalculo = { porCem: Nutrientes100; quantidadeG: number | null };

const CAMPOS = ['kcal', 'proteinaG', 'carboidratoG', 'lipidioG', 'fibraG'] as const;

/**
 * Σ(nutriente de cada ingrediente) × porção / rendimento. Cada ingrediente pela RN-02 (valor por 100 g × gramas / 100;
 * sem valor na TACO conta 0 e vai para `semValor`); quantidade inválida (null) fica fora. Rendimento ou porção
 * inválidos → null (a tela não mostra conta).
 */
export function nutrientesPorPorcao(ingredientes: IngredienteCalculo[], rendimentoG: number | null, porcaoG: number | null): (Nutrientes & { semValor: (keyof Nutrientes)[] }) | null {
  if (!rendimentoG || !porcaoG || rendimentoG <= 0 || porcaoG <= 0) return null;
  const total: Nutrientes = { ...ZERO };
  const semValor = new Set<keyof Nutrientes>();
  for (const i of ingredientes) {
    if (i.quantidadeG === null) continue;
    const n = nutrientesDoItem(i.porCem, i.quantidadeG);
    for (const c of CAMPOS) total[c] = arredondar(total[c] + n[c], 6);
    for (const c of n.semValor) semValor.add(c);
  }
  const fator = porcaoG / rendimentoG;
  const porPorcao: Nutrientes = { ...ZERO };
  for (const c of CAMPOS) porPorcao[c] = arredondar(total[c] * fator, 6);
  return { ...porPorcao, semValor: CAMPOS.filter((c) => semValor.has(c)) };
}

/** "Por porção: 500 kcal · proteína 12,5 g · …" — RN-02: kcal inteiro, gramas com 1 casa, vírgula decimal. */
export const textoPorPorcao = (n: Nutrientes): string =>
  `Por porção: ${kcalTexto(n.kcal)} kcal · proteína ${gTexto(n.proteinaG)} g · carboidrato ${gTexto(n.carboidratoG)} g · lipídio ${gTexto(n.lipidioG)} g · fibra ${gTexto(n.fibraG)} g`;
