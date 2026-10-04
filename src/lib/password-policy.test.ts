import { describe, expect, it } from 'vitest';
import { validatePasswordPolicy } from './password-policy';

const common = new Set(['password123', 'qwerty12345']);

describe('validatePasswordPolicy (US-002)', () => {
  it.each([
    ['Nutri2026segura', null],
    ['curta1', 'A senha precisa ter pelo menos 10 caracteres.'],
    ['somenteletras', 'A senha precisa ter pelo menos 1 letra e 1 número.'],
    ['1234567890', 'A senha precisa ter pelo menos 1 letra e 1 número.'],
    ['Password123', 'Essa senha é muito comum. Escolha outra.'],
  ])('%s → %s', (pw, expected) => {
    expect(validatePasswordPolicy(pw, common)).toBe(expected);
  });
  it('recusa senha acima de 128 caracteres', () => {
    expect(validatePasswordPolicy('a1'.repeat(65), common)).toBe('A senha pode ter no máximo 128 caracteres.');
  });
  it('N4: letra e número por classe Unicode — "×" e "÷" não contam como letra; "Ç" conta', () => {
    expect(validatePasswordPolicy('××××××××11')).toBe('A senha precisa ter pelo menos 1 letra e 1 número.');
    expect(validatePasswordPolicy('÷÷÷÷÷÷÷÷÷1')).toBe('A senha precisa ter pelo menos 1 letra e 1 número.');
    expect(validatePasswordPolicy('ÇãoÇãoÇão1')).toBeNull();
    expect(validatePasswordPolicy('ΑβγδεζηθικΛ1')).toBeNull(); // grego também é letra
  });
});
