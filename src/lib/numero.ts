import { z } from 'zod';

/** Número digitado ("70,5", "70.5", " 70 "). Vazio → null; qualquer outra coisa (unidade, milhar, letra) → NaN. */
export function lerDecimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return Number.NaN;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Meio para cima em `casas` decimais (RN-14). Pela notação exponencial: 1.005 → 1.01 (e não 1.00). */
export function arredondar(v: number, casas = 0): number {
  if (!Number.isFinite(v) || String(v).includes('e')) return Math.round(v * 10 ** casas) / 10 ** casas;
  return Number(`${Math.round(Number(`${v}e${casas}`))}e-${casas}`);
}

/** Vírgula decimal (RNF-12), sem separador de milhar ("2008 kcal", como a spec escreve). */
export function formatarDecimal(v: number, casas: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false }).format(arredondar(v, casas));
}

/** Campo numérico obrigatório de formulário: vazio, lixo ou fora de [min, max] → `msg`. */
export const decimalEntre = (msg: string, min: number, max: number) =>
  z.unknown().transform((v, ctx) => {
    const n = lerDecimal(v);
    if (n === null || Number.isNaN(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

/** Igual a `decimalEntre`, mas vazio vale `null`. */
export const decimalOpcionalEntre = (msg: string, min: number, max: number) =>
  z.unknown().transform((v, ctx): number | null => {
    const n = lerDecimal(v);
    if (n === null) return null;
    if (Number.isNaN(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });
