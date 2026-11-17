import { describe, expect, it } from 'vitest';
import { formatarCep, normalizarCep } from './cep';

describe('CEP (Plano 18, RN-262)', () => {
  it('normalizarCep: tira pontos, traço e espaços; só 8 dígitos', () => {
    for (const v of ['01310-100', '01.310-100', '01310 100', ' 01310100 ']) expect(normalizarCep(v), v).toBe('01310100');
    for (const v of ['1310100', '013101000', '01310-10a', '13.015/904', '']) expect(normalizarCep(v), v).toBeNull();
  });

  it('formatarCep: 8 dígitos → 00000-000; outra coisa volta como está', () => {
    expect(formatarCep('01310100')).toBe('01310-100');
    expect(formatarCep('1310100')).toBe('1310100');
  });
});
