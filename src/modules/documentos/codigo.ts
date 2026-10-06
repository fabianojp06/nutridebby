import { randomBytes } from 'node:crypto';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** RN-142: 60 bits aleatórios em base32 Crockford (12 caracteres). */
const [QUATRO, CINCO, MASCARA] = [BigInt(4), BigInt(5), BigInt(31)]; // sem literais 4n/5n: o tsconfig mira abaixo do ES2020

export function gerarCodigo(): string {
  let n = randomBytes(8).readBigUInt64BE() >> QUATRO;
  let s = '';
  for (let i = 0; i < 12; i++) {
    s = ALFABETO[Number(n & MASCARA)] + s;
    n >>= CINCO;
  }
  return s;
}

/** Aceita "abcd-efgh-jkmn", espaços e minúsculas; I/L → 1, O → 0 (Crockford). Nulo se não fechar 12 caracteres válidos. */
export function normalizarCodigo(e: unknown): string | null {
  if (typeof e !== 'string' || e.length > 40) return null;
  const s = e.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

export const formatarCodigo = (c: string): string => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
