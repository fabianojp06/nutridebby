import { describe, expect, it } from 'vitest';
import { formatarCodigo, gerarCodigo, normalizarCodigo } from './codigo';

describe('código de verificação (RN-142)', () => {
  it('12 caracteres Crockford, sem I, L, O, U; 60 bits (sem repetição em 10 mil)', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      vistos.add(c);
    }
    expect(vistos.size).toBe(10_000);
  });
  it('aceita hífen, espaço e minúsculas; I/L viram 1 e O vira 0; U e tamanho errado são inválidos', () => {
    expect(normalizarCodigo('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizarCodigo(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizarCodigo('ILO0-0000-0000')).toBe('110000000000'); // I e L → 1, O → 0
    expect(normalizarCodigo('UUUU-0000-0000')).toBeNull();
    expect(normalizarCodigo('ABC')).toBeNull();
    expect(normalizarCodigo(42)).toBeNull();
    expect(formatarCodigo('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
  });
});
