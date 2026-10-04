import { describe, expect, it } from 'vitest';
import { criarLimite } from './limite-memoria';

describe('criarLimite (1 réplica do app — D10)', () => {
  it('permite até max por janela e volta a permitir depois dela', () => {
    const l = criarLimite({ janelaMs: 1000, max: 2 });
    expect([l.permitir('a', 0), l.permitir('a', 10), l.permitir('a', 20)]).toEqual([true, true, false]);
    expect(l.permitir('b', 20)).toBe(true); // outra chave, outro balde
    expect(l.permitir('a', 1001)).toBe(true);
  });
  it('não cresce sem limite: chaves vencidas saem na varredura', () => {
    const l = criarLimite({ janelaMs: 10, max: 1 });
    for (let i = 0; i < 5000; i++) l.permitir(`k${i}`, 0);
    l.permitir('nova', 100);
    expect(l.tamanho()).toBe(1);
  });
});
