import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { arredondar, decimalEntre, decimalOpcionalEntre, formatarDecimal, lerDecimal } from './numero';

describe('números digitados em pt-BR (RNF-12, Review Focus 2)', () => {
  it('vírgula ou ponto decimal, espaços ignorados; vazio é null; lixo é NaN', () => {
    expect(lerDecimal('70,5')).toBe(70.5);
    expect(lerDecimal('70.5')).toBe(70.5);
    expect(lerDecimal(' 70 ')).toBe(70);
    expect(lerDecimal('1,55')).toBe(1.55);
    expect(lerDecimal('')).toBeNull();
    expect(lerDecimal('   ')).toBeNull();
    expect(lerDecimal(undefined)).toBeNull();
    for (const v of ['7O', '70,5 kg', '1.234,5', '70,', ',5', 'NaN', '1e3']) expect(lerDecimal(v), v).toBeNaN();
  });
  it('arredonda meio para cima sem erro de ponto flutuante (RN-14)', () => {
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(arredondar(1648.75)).toBe(1649);
    expect(arredondar(2007.6375)).toBe(2008);
    expect(arredondar(22.857142857, 2)).toBe(22.86);
  });
  it('formata com vírgula e as casas pedidas, sem separador de milhar', () => {
    expect(formatarDecimal(22.857142857, 2)).toBe('22,86');
    expect(formatarDecimal(70, 1)).toBe('70,0');
    expect(formatarDecimal(2008, 0)).toBe('2008');
  });
  it('schemas de campo: fora da faixa, vazio ou lixo → a mensagem do campo (nunca NaN gravado)', () => {
    const peso = z.object({ p: decimalEntre('Peso deve estar entre 1 e 400 kg', 1, 400) });
    expect(peso.parse({ p: '70,5' })).toEqual({ p: 70.5 });
    for (const p of ['0', '500', '', '7O']) expect(peso.safeParse({ p }).error?.issues[0].message, p).toBe('Peso deve estar entre 1 e 400 kg');
    const circ = z.object({ c: decimalOpcionalEntre('Circunferência deve estar entre 5 e 300 cm', 5, 300) });
    expect(circ.parse({ c: '' })).toEqual({ c: null });
    expect(circ.safeParse({ c: '2' }).success).toBe(false);
  });
});
