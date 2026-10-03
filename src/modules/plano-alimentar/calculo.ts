import { arredondar, casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { gramasDaMedidaTexto } from '@/modules/alimentos/medidas-constantes';
import { QUANTIDADE_MAX, QUANTIDADE_MIN } from './constantes';

/** RN-02. Sem banco e sem React: o editor (cliente), o servidor e o PDF usam a mesma conta. */
export type Nutrientes = { kcal: number; proteinaG: number; carboidratoG: number; lipidioG: number; fibraG: number };
export type ItemCalculo = { id: string; quantidadeG: number | null; porCem: Nutrientes100; substituiItemId: string | null };

const CAMPOS = ['kcal', 'proteinaG', 'carboidratoG', 'lipidioG', 'fibraG'] as const;
export const ZERO: Nutrientes = { kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 };

/** Gramas digitados ("150", "1,5") dentro de [0,1; 5000]; qualquer outra coisa → null (Review Focus 2). */
export function lerQuantidade(v: unknown): number | null {
  const n = lerDecimal(v);
  if (n === null || Number.isNaN(n) || n < QUANTIDADE_MIN || n > QUANTIDADE_MAX) return null;
  return n;
}

/** valor_por_100g × gramas / 100; sem valor na TACO conta 0 e vai para `semValor` (Review Focus 3). */
export function nutrientesDoItem(porCem: Nutrientes100, gramas: number): Nutrientes & { semValor: (keyof Nutrientes)[] } {
  const semValor: (keyof Nutrientes)[] = [];
  const out = { ...ZERO };
  for (const c of CAMPOS) {
    const v = porCem[c];
    if (v === null) semValor.push(c);
    else out[c] = arredondar((v * gramas) / 100, 6);
  }
  return { ...out, semValor };
}

const somar = (a: Nutrientes, b: Nutrientes): Nutrientes => ({
  kcal: arredondar(a.kcal + b.kcal, 6),
  proteinaG: arredondar(a.proteinaG + b.proteinaG, 6),
  carboidratoG: arredondar(a.carboidratoG + b.carboidratoG, 6),
  lipidioG: arredondar(a.lipidioG + b.lipidioG, 6),
  fibraG: arredondar(a.fibraG + b.fibraG, 6),
});

/** Só itens principais (substituiItemId nulo) com quantidade válida (RN-02). */
export function totalDosItens(itens: ItemCalculo[]): Nutrientes {
  let t = ZERO;
  for (const i of itens) {
    if (i.substituiItemId !== null || i.quantidadeG === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { semValor, ...n } = nutrientesDoItem(i.porCem, i.quantidadeG);
    t = somar(t, n);
  }
  return t;
}

export const totalDoDia = (refeicoes: { itens: ItemCalculo[] }[]): Nutrientes => refeicoes.reduce((t, r) => somar(t, totalDosItens(r.itens)), ZERO);

export type Faixa = 'verde' | 'amarelo' | 'vermelho';
const ROTULO: Record<Faixa, string> = { verde: 'Dentro da meta', amarelo: 'Atenção', vermelho: 'Fora da meta' };

const sinal = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

/** RN-02: |desvio| ≤ 5% verde; ≤ 10% amarelo; > 10% vermelho. Texto com sinal e até 1 casa ("+7,5%"). */
export function indicadorMeta(kcal: number, meta: number | null): { faixa: Faixa; desvio: number; rotulo: string; texto: string } | null {
  if (meta === null || !(meta > 0)) return null;
  const desvio = arredondar((kcal - meta) / meta, 6);
  const abs = Math.abs(desvio);
  const faixa: Faixa = abs <= 0.05 ? 'verde' : abs <= 0.1 ? 'amarelo' : 'vermelho';
  const pct = arredondar(abs * 100, 1);
  return { faixa, desvio, rotulo: ROTULO[faixa], texto: `${sinal(desvio)}${formatarDecimal(pct, casasDecimais(pct))}%` };
}

type Macro = { g: number; gPorKg: number | null; pctVet: number | null };

/** US-022 "Distribuição de macros": g, g/kg (peso da última antropometria) e % do VET (4/4/9 kcal/g). */
export function distribuicaoMacros(total: Nutrientes, pesoKg: number | null): { proteina: Macro; carboidrato: Macro; lipidio: Macro; fibraG: number } {
  const macro = (g: number, kcalPorG: number): Macro => ({
    g,
    gPorKg: pesoKg && pesoKg > 0 ? arredondar(g / pesoKg, 6) : null,
    pctVet: total.kcal > 0 ? arredondar(((g * kcalPorG) / total.kcal) * 100, 6) : null,
  });
  return { proteina: macro(total.proteinaG, 4), carboidrato: macro(total.carboidratoG, 4), lipidio: macro(total.lipidioG, 9), fibraG: total.fibraG };
}

/** Exibição (RN-02): kcal inteiro; gramas com 1 casa. */
export const kcalTexto = (n: number): string => formatarDecimal(n, 0);
export const gTexto = (n: number): string => formatarDecimal(n, 1);

/** US-023: "+12 kcal" (substituição × principal), com os dois já arredondados como aparecem na tela. */
export function diferencaKcal(sub: number, principal: number): string {
  const d = arredondar(sub, 0) - arredondar(principal, 0);
  return `${sinal(d)}${Math.abs(d)} kcal`;
}

type NutrientesDoItem = ReturnType<typeof nutrientesDoItem>;

/**
 * Diferença do editor e do PDF: sem kcal na TACO na substituição ou no principal, nenhuma (o lado sem valor conta 0
 * e daria um número clínico enganoso, ex.: "−150 kcal").
 */
export const diferencaKcalDoItem = (sub: NutrientesDoItem, principal: NutrientesDoItem): string | null =>
  sub.semValor.includes('kcal') || principal.semValor.includes('kcal') ? null : diferencaKcal(sub.kcal, principal.kcal);

/** Quantidade do item como o paciente lê (PDF e portal): medida caseira com os gramas, ou só os gramas ("12,5 g"). */
export const quantidadeDoItem = (i: { quantidadeG: number; medidaCaseiraTxt: string | null }): string =>
  i.medidaCaseiraTxt ? `${i.medidaCaseiraTxt} (${gramasDaMedidaTexto(i.quantidadeG)})` : gramasDaMedidaTexto(i.quantidadeG);
