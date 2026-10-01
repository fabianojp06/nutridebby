import { describe, expect, it } from 'vitest';
import { normalizarTexto, normalizeEmail } from './text';

describe('normalizeEmail', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normalizeEmail('  Admin@Exemplo.COM ')).toBe('admin@exemplo.com');
  });
  it('mantém e-mail já normalizado', () => {
    expect(normalizeEmail('debby@exemplo.com')).toBe('debby@exemplo.com');
  });
});

describe('normalizarTexto', () => {
  it('apara as pontas e junta espaços, tabs e quebras; não-texto vira vazio', () => {
    expect(normalizarTexto('  Pão \t low\n\ncarb  ')).toBe('Pão low carb');
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(42)).toBe('');
  });
});
