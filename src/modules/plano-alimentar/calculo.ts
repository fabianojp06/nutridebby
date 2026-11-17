import { arredondar, casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { gramasDaMedidaTexto } from '@/modules/alimentos/medidas-constantes';
import type { ChaveNutriente } from '@/modules/alimentos/nutrientes';
import { MAX_TEXTO, QUANTIDADE_MAX, QUANTIDADE_MIN } from './constantes';
import { refeicoesDoDia, type DiaDaSemana } from './dias';

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

/** Soma de dois totais com o arredondamento da RN-02 (o editor soma os totais de cada refeição guardados, PM-PA9). */
export const somarNutrientes = (a: Nutrientes, b: Nutrientes): Nutrientes => ({
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
    t = somarNutrientes(t, n);
  }
  return t;
}

export const totalDoDia = (refeicoes: { itens: ItemCalculo[] }[]): Nutrientes => refeicoes.reduce((t, r) => somarNutrientes(t, totalDosItens(r.itens)), ZERO);

/** RN-247: o total de um dia é o das refeições que valem nele (o perfil do dia), nunca a soma de todas. */
export const totaisDoDia = (refeicoes: { diasSemana: readonly number[]; itens: ItemCalculo[] }[], dia: DiaDaSemana): Nutrientes => totalDoDia(refeicoesDoDia(refeicoes, dia));

/** RN-235: micros por 100 g do alimento (`foods.micros`, ou a cópia congelada); `null`/ausente = sem valor na fonte. */
export type MicrosPorCem = Partial<Record<ChaveNutriente, number | null>>;
export type ItemComMicros = ItemCalculo & { micros: MicrosPorCem | null };

/** RN-236: micro do item = valor por 100 g × gramas / 100; as chaves sem valor ficam fora. */
export function microsDoItem(i: { quantidadeG: number; micros: MicrosPorCem | null }): Partial<Record<ChaveNutriente, number>> {
  const out: Partial<Record<ChaveNutriente, number>> = {};
  if (!i.micros) return out;
  for (const [k, v] of Object.entries(i.micros) as [ChaveNutriente, number | null | undefined][]) {
    if (typeof v === 'number') out[k] = arredondar((v * i.quantidadeG) / 100, 6);
  }
  return out;
}

/**
 * RN-236: soma de cada nutriente pedido com a regra da RN-02 (só itens principais com quantidade válida); item sem o
 * valor conta 0 e entra em `semValor` ("{n} itens sem valor de {nutriente}"). Para um dia, passe `refeicoesDoDia(…)`.
 */
export function totalMicros<C extends ChaveNutriente>(refeicoes: { itens: ItemComMicros[] }[], chaves: readonly C[]): Record<C, { total: number; semValor: number }> {
  const out = Object.fromEntries(chaves.map((c) => [c, { total: 0, semValor: 0 }])) as Record<C, { total: number; semValor: number }>;
  for (const r of refeicoes) {
    for (const i of r.itens) {
      if (i.substituiItemId !== null || i.quantidadeG === null) continue;
      const m = microsDoItem({ quantidadeG: i.quantidadeG, micros: i.micros });
      for (const c of chaves) {
        const v = m[c];
        if (v === undefined) out[c].semValor += 1;
        else out[c].total = arredondar(out[c].total + v, 6);
      }
    }
  }
  return out;
}

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

/**
 * RN-245: os itens da refeição em texto, para a troca para texto livre (Tarefa 7) e a minha refeição carregada num plano
 * livre (Tarefa 8): `"{nome} — {quantidade}"` dos principais unidos por "; ", cada substituição como
 * `" (ou {nome} — {quantidade})"` logo depois do seu principal, cortado em 2000 caracteres (`MAX_TEXTO`, o CHECK
 * `meals_descricao_livre_tamanho`). A quantidade é a medida caseira quando há ("4 colheres de sopa", o exemplo da
 * US-235), senão os gramas ("90,5 g").
 */
export function itensComoTexto(itens: { id: string; nome: string; quantidadeG: number; medidaCaseiraTxt: string | null; substituiItemId: string | null }[]): string {
  const parte = (i: (typeof itens)[number]) => `${i.nome} — ${i.medidaCaseiraTxt || gramasDaMedidaTexto(i.quantidadeG)}`;
  const texto = itens
    .filter((i) => i.substituiItemId === null)
    .map((p) => parte(p) + itens.filter((s) => s.substituiItemId === p.id).map((s) => ` (ou ${parte(s)})`).join(''))
    .join('; ');
  const cortado = texto.slice(0, MAX_TEXTO);
  // não deixar meio caractere (par substituto do UTF-16, ex.: emoji no nome do "Meu alimento") no fim
  return /[\uD800-\uDBFF]$/.test(cortado) ? cortado.slice(0, -1) : cortado;
}
