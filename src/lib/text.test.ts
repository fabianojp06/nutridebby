import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './text';

describe('normalizeEmail', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normalizeEmail('  Admin@Exemplo.COM ')).toBe('admin@exemplo.com');
  });
  it('mantém e-mail já normalizado', () => {
    expect(normalizeEmail('debby@exemplo.com')).toBe('debby@exemplo.com');
  });
});
