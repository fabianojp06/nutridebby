import { describe, expect, it } from 'vitest';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import {
  diferencaKcal,
  diferencaKcalDoItem,
  distribuicaoMacros,
  gTexto,
  indicadorMeta,
  itensComoTexto,
  kcalTexto,
  lerQuantidade,
  microsDoItem,
  nutrientesDoItem,
  totaisDoDia,
  totalDoDia,
  totalDosItens,
  totalMicros,
  type ItemCalculo,
  type ItemComMicros,
  type MicrosPorCem,
} from './calculo';
import { refeicoesDoDia } from './dias';

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

  it('diferença da substituição só quando os dois lados têm kcal na TACO (editor e PDF, US-023)', () => {
    const leite = nutrientesDoItem({ kcal: null, proteinaG: 3, carboidratoG: 4.7, lipidioG: 3, fibraG: 0 }, 200); // "Sem valor na TACO"
    const pao = nutrientesDoItem(porCem(300, 8, 59, 3, 2), 50);
    const tapioca = nutrientesDoItem(porCem(348, 0, 86, 0, 0), 40);
    expect(diferencaKcalDoItem(tapioca, pao)).toBe('−11 kcal');
    expect(diferencaKcalDoItem(leite, pao)).toBeNull(); // substituição sem kcal: nada de "−150 kcal"
    expect(diferencaKcalDoItem(pao, leite)).toBeNull(); // principal sem kcal
  });

  it('recalcular 6 refeições × 40 itens leva bem menos de 100 ms (RNF-01)', () => {
    const refeicoes = Array.from({ length: 6 }, (_, r) => ({ itens: Array.from({ length: 7 }, (_, i) => item(`${r}-${i}`, 100 + i, porCem(100 + i, 5, 10, 3, 1))) }));
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) totalDoDia(refeicoes);
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});

const itemM = (id: string, g: number | null, micros: MicrosPorCem | null, sub: string | null = null): ItemComMicros => ({ ...item(id, g, porCem(100), sub), micros });

describe('RN-236: micros do item e do dia (só itens principais, contando os sem valor)', () => {
  it('microsDoItem: valor por 100 g × gramas / 100; sem valor fica fora', () => {
    expect(microsDoItem({ quantidadeG: 150, micros: { calcio_mg: 120, ferro_mg: null, vitamina_b12_mcg: 0.4 } })).toEqual({ calcio_mg: 180, vitamina_b12_mcg: 0.6 });
    expect(microsDoItem({ quantidadeG: 150, micros: null })).toEqual({});
  });

  it('totalMicros ignora substituições e quantidade inválida e conta semValor (micros nulo ou chave sem valor)', () => {
    const refeicoes = [
      { itens: [itemM('leite', 200, { calcio_mg: 123 }), itemM('iogurte', 170, { calcio_mg: 1000 }, 'leite'), itemM('pao', 50, { calcio_mg: null, ferro_mg: 2 })] },
      { itens: [itemM('arroz', 100, { calcio_mg: 4 }), itemM('feijao', 100, null), itemM('sal', null, { calcio_mg: 1000 })] },
    ];
    expect(totalMicros(refeicoes, ['calcio_mg', 'ferro_mg', 'vitamina_d_mcg'])).toEqual({
      calcio_mg: { total: 250, semValor: 2 }, // 246 (leite) + 4 (arroz); pão e feijão sem valor
      ferro_mg: { total: 1, semValor: 3 },
      vitamina_d_mcg: { total: 0, semValor: 4 },
    });
    expect(totalMicros([], ['calcio_mg'])).toEqual({ calcio_mg: { total: 0, semValor: 0 } });
  });

  it('totalMicros de um dia: refeicoesDoDia antes', () => {
    const r = [
      { diasSemana: [1, 2, 3, 4, 5], itens: [itemM('a', 100, { ferro_mg: 1 })] },
      { diasSemana: [0, 6], itens: [itemM('b', 100, { ferro_mg: 5 })] },
    ];
    expect(totalMicros(refeicoesDoDia(r, 6), ['ferro_mg']).ferro_mg).toEqual({ total: 5, semValor: 0 });
  });
});

describe('RN-247: total do dia por perfil (nunca a soma de dois "Almoço")', () => {
  it('totaisDoDia com "Almoço" seg–sex e "Almoço" sáb–dom: no sábado soma só o de sáb–dom', () => {
    const refeicoes = [
      { diasSemana: [0, 1, 2, 3, 4, 5, 6], itens: [item('cafe', 100, porCem(50))] },
      { diasSemana: [1, 2, 3, 4, 5], itens: [item('almoco-semana', 100, porCem(600))] },
      { diasSemana: [0, 6], itens: [item('almoco-fim', 100, porCem(800))] },
    ];
    expect(totaisDoDia(refeicoes, 6).kcal).toBe(850);
    expect(totaisDoDia(refeicoes, 2).kcal).toBe(650);
    expect(totaisDoDia([{ diasSemana: [1], itens: [item('a', 100, porCem(50))] }], 0).kcal).toBe(0);
  });
});

describe('RN-245: itens como texto (troca para texto livre e minha refeição num plano livre)', () => {
  const it_ = (id: string, nome: string, quantidadeG: number | null, medidaCaseiraTxt: string | null, substituiItemId: string | null = null) => ({ id, nome, quantidadeG, medidaCaseiraTxt, substituiItemId });

  it('principais unidos por "; ", substituições "(ou …)" depois do principal; com medida caseira, a medida e os gramas (Res. CFN 594/2017, art. 4º, § 1º, VIII)', () => {
    const itens = [
      it_('arroz', 'Arroz branco, cozido', 100, '4 colheres de sopa'),
      it_('feijao', 'Feijão carioca, cozido', 86, '1 concha média'),
      it_('macarrao', 'Macarrão, cozido', 110, '1 escumadeira', 'arroz'),
      it_('lentilha', 'Lentilha, cozida', 90.5, null, 'feijao'),
      it_('grao', 'Grão-de-bico, cozido', 80, null, 'feijao'),
    ];
    expect(itensComoTexto(itens)).toBe(
      'Arroz branco, cozido — 4 colheres de sopa (100 g) (ou Macarrão, cozido — 1 escumadeira (110 g)); Feijão carioca, cozido — 1 concha média (86 g) (ou Lentilha, cozida — 90,5 g) (ou Grão-de-bico, cozido — 80 g)',
    );
  });

  it('sem medida caseira, só os gramas; sem itens, texto vazio', () => {
    expect(itensComoTexto([it_('a', 'Arroz branco, cozido', 100, '4 colheres de sopa'), it_('b', 'Azeite', 5, null)])).toBe('Arroz branco, cozido — 4 colheres de sopa (100 g); Azeite — 5 g');
    expect(itensComoTexto([])).toBe('');
    // quantidade em erro no editor (nula): o texto digitado como está, sem gramas inventados
    expect(itensComoTexto([it_('a', 'Feijão', null, 'abc g')])).toBe('Feijão — abc g');
  });

  it('corta em 2000 caracteres', () => {
    const itens = Array.from({ length: 100 }, (_, i) => it_(`i${i}`, `Alimento de nome bem comprido número ${i}`, 100, null));
    const t = itensComoTexto(itens);
    expect(t).toHaveLength(2000);
    expect(t.startsWith('Alimento de nome bem comprido número 0 — 100 g; Alimento')).toBe(true);
    // com medida caseira (o texto fica mais longo com os gramas): o corte continua em 2000
    const comMedida = itensComoTexto(Array.from({ length: 100 }, (_, i) => it_(`m${i}`, `Alimento ${i}`, 100, '4 colheres de sopa')));
    expect(comMedida).toHaveLength(2000);
    expect(comMedida.startsWith('Alimento 0 — 4 colheres de sopa (100 g); Alimento 1 — 4 colheres de sopa (100 g); ')).toBe(true);
    // o corte não deixa meio emoji (par substituto do UTF-16) no fim
    expect(itensComoTexto([it_('a', `${'x'.repeat(1999)}🍎`, 100, null)])).toBe('x'.repeat(1999));
  });
});
