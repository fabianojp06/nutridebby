import { describe, expect, it } from 'vitest';
import { buscaDaUrl } from './lista';

// SUS-109 (regra 3): a busca da caixa e da "Nova conversa" vira parâmetro de SQL; o NUL daria 22021 com o termo (nome do
// paciente) no CONTEXT do erro. Sai antes, como o surrogate sem par.
describe('Plano 25 — buscaDaUrl sem caractere que o Postgres recusa', () => {
  it('tira o NUL e o surrogate sem par; mantém emoji, espaço interno e o corte em 100', () => {
    expect(buscaDaUrl('An\u0000a\ud800')).toBe('Ana');
    expect(buscaDaUrl(' Ana 😀 Maria ')).toBe('Ana 😀 Maria');
    expect(buscaDaUrl('\u0000')).toBe('');
    expect(buscaDaUrl('a'.repeat(150))).toHaveLength(100);
  });
});
