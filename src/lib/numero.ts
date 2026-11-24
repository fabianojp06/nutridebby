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

/**
 * O número como texto de campo, com vírgula decimal, **todas** as casas e nunca em notação exponencial: `String(1e-7)` é
 * "1e-7", que `lerDecimal` recusa (um valor gravado que volta ao formulário e trava a edição). Expande os dígitos do
 * `String(n)` (a menor representação que volta ao mesmo número), sem arredondar: `lerDecimal(numeroParaCampo(n)) === n`.
 */
export function numeroParaCampo(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s.replace('.', ',');
  const [, sinal, inteira, fracao = '', expoente] = m;
  const digitos = inteira + fracao;
  const ponto = inteira.length + Number(expoente); // onde a vírgula cai nos dígitos
  if (ponto <= 0) return `${sinal}0,${'0'.repeat(-ponto)}${digitos}`;
  if (ponto >= digitos.length) return `${sinal}${digitos}${'0'.repeat(ponto - digitos.length)}`;
  return `${sinal}${digitos.slice(0, ponto)},${digitos.slice(ponto)}`;
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

/** Casas que o valor digitado tinha (até 6): não arredonda nem cai em notação exponencial. */
export const casasDecimais = (n: number): number => (Number.isInteger(n) ? 0 : Math.min(6, (n.toFixed(6).replace(/0+$/, '').split('.')[1] ?? '').length));

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
