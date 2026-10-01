import { describe, expect, it } from 'vitest';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { diferencaKcal, distribuicaoMacros, gTexto, indicadorMeta, kcalTexto, lerQuantidade, nutrientesDoItem, totalDoDia, totalDosItens, type ItemCalculo } from './calculo';

const porCem = (kcal: number | null, p: number | null = 0, c: number | null = 0, l: number | null = 0, f: number | null = 0): Nutrientes100 => ({ kcal, proteinaG: p, carboidratoG: c, lipidioG: l, fibraG: f });
const item = (id: string, g: number | null, pc = porCem(100), sub: string | null = null): ItemCalculo => ({ id, quantidadeG: g, porCem: pc, substituiItemId: sub });

describe('RN-02: nutriente do item = valor por 100 g × gramas / 100', () => {
  it('"Cálculo do item": 130 kcal/100 g × 150 g = 195 kcal', () => {
    expect(nutrientesDoItem(porCem(130, 2, 28, 0.5, 1.6), 150)).toEqual({ kcal: 195, proteinaG: 3, carboidratoG: 42, lipidioG: 0.75, fibraG: 2.4, semValor: [] });
  });

  it('Review Focus 3: nutriente sem valor na TACO conta 0 e é apontado, nunca NaN', () => {
    const leite = { kcal: null, proteinaG: null, carboidratoG: 4.6, lipidioG: null, fibraG: null };
    const n = nutrientesDoItem(leite, 200);
    expect(n).toEqual({ kcal: 0, proteinaG: 0, carboidratoG: 9.2, lipidioG: 0, fibraG: 0, semValor: ['kcal', 'proteinaG', 'lipidioG', 'fibraG'] });
    expect(Number.isNaN(totalDosItens([item('a', 200, leite)]).kcal)).toBe(false);
  });

  it('totais contam só itens principais com quantidade válida (substituições e quantidade inválida ficam fora)', () => {
    const itens = [item('pao', 50, porCem(300)), item('tapioca', 40, porCem(240), 'pao'), item('queijo', null, porCem(264)), item('cafe', 100, porCem(9))];
    expect(totalDosItens(itens).kcal).toBe(159); // 150 (pão) + 9 (café)
    expect(totalDoDia([{ itens }, { itens: [item('arroz', 100, porCem(128))] }]).kcal).toBe(287);
  });

  it('Review Focus 2: quantidade digitada — vírgula e ponto valem; lixo, zero, negativo e acima de 5000 g não', () => {
    expect(lerQuantidade('1,5')).toBe(1.5);
    expect(lerQuantidade(' 150 ')).toBe(150);
    expect(lerQuantidade(150)).toBe(150);
    for (const v of ['abc', '0', '-10', '99999', '', null, '0,05', '1.2.3']) expect(lerQuantidade(v), String(v)).toBeNull();
  });
});

describe('RN-02: indicador × meta_kcal', () => {
  it('"Indicador de meta": 2080 verde (4%), 2150 amarelo (7,5%), 2300 vermelho (15%)', () => {
    expect(indicadorMeta(2080, 2000)).toEqual({ faixa: 'verde', desvio: 0.04, rotulo: 'Dentro da meta', texto: '+4%' });
    expect(indicadorMeta(2150, 2000)).toEqual({ faixa: 'amarelo', desvio: 0.075, rotulo: 'Atenção', texto: '+7,5%' });
    expect(indicadorMeta(2300, 2000)).toEqual({ faixa: 'vermelho', desvio: 0.15, rotulo: 'Fora da meta', texto: '+15%' });
  });

  it('limites exatos (5% é verde, 10% é amarelo), abaixo da meta e sem meta', () => {
    expect(indicadorMeta(2100, 2000)?.faixa).toBe('verde');
    expect(indicadorMeta(1800, 2000)).toMatchObject({ faixa: 'amarelo', texto: '−10%' });
    expect(indicadorMeta(1799, 2000)?.faixa).toBe('vermelho');
    expect(indicadorMeta(1500, null)).toBeNull();
    expect(indicadorMeta(0, 2000)).toMatchObject({ faixa: 'vermelho', texto: '−100%' });
  });
});

describe('distribuição de macros e exibição', () => {
  it('"Distribuição de macros": g, g/kg e % do VET (4/4/9 kcal por g) e fibra total', () => {
    const total = { kcal: 2000, proteinaG: 100, carboidratoG: 250, lipidioG: 66.7, fibraG: 28 };
    expect(distribuicaoMacros(total, 80)).toEqual({
      proteina: { g: 100, gPorKg: 1.25, pctVet: 20 },
      carboidrato: { g: 250, gPorKg: 3.125, pctVet: 50 },
      lipidio: { g: 66.7, gPorKg: 0.83375, pctVet: 30.015 },
      fibraG: 28,
    });
  });

  it('sem peso, g/kg é null; sem kcal, % do VET é null', () => {
    const d = distribuicaoMacros({ kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 }, null);
    expect(d.proteina).toEqual({ g: 0, gPorKg: null, pctVet: null });
  });

  it('diferença da substituição e arredondamento de exibição (kcal inteiro, gramas com 1 casa)', () => {
    expect(diferencaKcal(162.4, 150)).toBe('+12 kcal');
    expect(diferencaKcal(140, 150)).toBe('−10 kcal');
    expect(diferencaKcal(150.2, 150)).toBe('0 kcal');
    expect(kcalTexto(194.5)).toBe('195');
    expect(gTexto(0.75)).toBe('0,8');
  });

  it('recalcular 6 refeições × 40 itens leva bem menos de 100 ms (RNF-01)', () => {
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({ itens: Array.from({ length: 7 }, (_, i) => item(`${r}-${i}`, 100 + i, porCem(100 + i, 5, 10, 3, 1))) }));
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) totalDoDia(refeicoes);
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});
