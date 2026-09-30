import { describe, expect, it } from 'vitest';
import { formatarTelefone, normalizarTelefone } from './telefone';

describe('telefone (RNF-12: exibido (11) 91234-5678, guardado em E.164)', () => {
  it('normaliza formatos brasileiros para +55 e mantém internacional com +', () => {
    for (const t of ['(11) 91234-5678', '11 91234 5678', '11912345678', '+55 11 91234-5678', '5511912345678', '011 91234-5678']) {
      expect(normalizarTelefone(t), t).toBe('+5511912345678');
    }
    expect(normalizarTelefone('(11) 3456-7890')).toBe('+551134567890');
    expect(normalizarTelefone('+351 912 345 678')).toBe('+351912345678');
  });
  it('recusa número incompleto, DDD inválido e celular de 9 dígitos que não começa com 9', () => {
    for (const t of ['1234', '(11) 81234-5678', '(01) 91234-5678', '(11) 1234-5678', '+0 123', 'abc']) expect(normalizarTelefone(t), t).toBeNull();
    expect(normalizarTelefone('   ')).toBeNull();
  });
  it('formata E.164 brasileiro para exibição; outros países ficam como estão', () => {
    expect(formatarTelefone('+5511912345678')).toBe('(11) 91234-5678');
    expect(formatarTelefone('+551134567890')).toBe('(11) 3456-7890');
    expect(formatarTelefone('+351912345678')).toBe('+351912345678');
  });
});
