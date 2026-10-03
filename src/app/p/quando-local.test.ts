import { describe, expect, it } from 'vitest';
import { precisaDaSigla } from './quando-local';

describe('RN-06 no PWA', () => {
  it('a sigla aparece só quando o fuso do aparelho é outro', () => {
    expect(precisaDaSigla('America/Sao_Paulo', 'America/Sao_Paulo')).toBe(false);
    expect(precisaDaSigla('Europe/Lisbon', 'America/Sao_Paulo')).toBe(true);
    expect(precisaDaSigla('', 'America/Sao_Paulo')).toBe(true); // sem informação: na dúvida, mostra
  });
});
