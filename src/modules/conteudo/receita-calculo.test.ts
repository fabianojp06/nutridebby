import { describe, expect, it } from 'vitest';
import { nutrientesPorPorcao, textoPorPorcao } from './receita-calculo';

const mistura = { kcal: 400, proteinaG: 10, carboidratoG: 50, lipidioG: 15, fibraG: 5 }; // por 100 g

describe('valor por porção (RN-11)', () => {
  it('US-051: ingredientes somando 2000 kcal, rendimento 1000 g, porção 250 g → 500 kcal, macros proporcionais', () => {
    const n = nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 500 }], 1000, 250)!;
    expect(n).toEqual({ kcal: 500, proteinaG: 12.5, carboidratoG: 62.5, lipidioG: 18.75, fibraG: 6.25, semValor: [] });
    expect(textoPorPorcao(n)).toBe('Por porção: 500 kcal · proteína 12,5 g · carboidrato 62,5 g · lipídio 18,8 g · fibra 6,3 g');
  });

  it('alimento sem valor na TACO conta 0 e é avisado (RN-02); quantidade inválida fica fora; rendimento/porção inválidos → null', () => {
    const semFibra = { ...mistura, fibraG: null };
    const n = nutrientesPorPorcao([{ porCem: semFibra, quantidadeG: 100 }, { porCem: mistura, quantidadeG: null }], 100, 100)!;
    expect(n.kcal).toBe(400);
    expect(n.fibraG).toBe(0);
    expect(n.semValor).toEqual(['fibraG']);
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 100 }], 0, 50)).toBeNull();
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 100 }], 100, null)).toBeNull();
  });

  it('porção = rendimento: a receita inteira', () => {
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 250 }], 250, 250)!.kcal).toBe(1000);
  });
});
