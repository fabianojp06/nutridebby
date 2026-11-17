import { describe, expect, it } from 'vitest';
import { lerDias, listaDeCompras, quantidadeTexto, vezesNaJanela } from './lista-compras';

const TODOS = [0, 1, 2, 3, 4, 5, 6];

describe('lista de compras (RN-13)', () => {
  it('"Arroz, tipo 1, cozido" 100 g no almoço e no jantar × 7 dias = 1,4 kg em "Cereais e derivados"', () => {
    const l = listaDeCompras(
      [
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100, diasSemana: TODOS },
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100, diasSemana: TODOS },
        { nome: 'Chuchu, cozido', grupo: 'Verduras, hortaliças e derivados', quantidadeG: 80, diasSemana: TODOS },
      ],
      7,
      3,
    );
    expect(l).toEqual([
      { grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 1400, texto: '1,4 kg' }] },
      { grupo: 'Verduras, hortaliças e derivados', itens: [{ nome: 'Chuchu, cozido', gramas: 560, texto: '560 g' }] },
    ]);
  });
  it('g abaixo de 1000, kg com 1 casa a partir de 1000; grupos na ordem da TACO, itens em ordem alfabética', () => {
    expect([quantidadeTexto(999), quantidadeTexto(1000), quantidadeTexto(12.5), quantidadeTexto(1060)]).toEqual(['999 g', '1,0 kg', '12,5 g', '1,1 kg']);
    expect([quantidadeTexto(999.99), quantidadeTexto(999.94), quantidadeTexto(12.46)]).toEqual(['1,0 kg', '999,9 g', '12,5 g']); // RN-13: kg a partir de 1000 depois de arredondar
    const l = listaDeCompras([{ nome: 'Ovo', grupo: 'Ovos e derivados', quantidadeG: 50, diasSemana: TODOS }, { nome: 'Banana', grupo: 'Frutas e derivados', quantidadeG: 50, diasSemana: TODOS }, { nome: 'Abacate', grupo: 'Frutas e derivados', quantidadeG: 50, diasSemana: TODOS }], 1, 1);
    expect(l.map((g) => g.grupo)).toEqual(['Frutas e derivados', 'Ovos e derivados']);
    expect(l[0].itens.map((i) => i.nome)).toEqual(['Abacate', 'Banana']);
  });
  it('RN-248 (Plano 19): 7 dias a partir de uma quarta somam o almoço de seg–sex 5 vezes (qua, qui, sex + seg, ter da semana seguinte) e o de sáb–dom 2', () => {
    const SEG_A_SEX = [1, 2, 3, 4, 5];
    const QUARTA = 3;
    expect(vezesNaJanela(SEG_A_SEX, QUARTA, 7)).toBe(5);
    expect(vezesNaJanela([0, 6], QUARTA, 7)).toBe(2);
    expect(vezesNaJanela([6], QUARTA, 3)).toBe(0); // qua, qui, sex
    expect(vezesNaJanela(SEG_A_SEX, QUARTA, 14)).toBe(10);
    const l = listaDeCompras(
      [
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100, diasSemana: SEG_A_SEX },
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 150, diasSemana: [0, 6] },
        { nome: 'Feijoada', grupo: 'Leguminosas e derivados', quantidadeG: 300, diasSemana: [6] },
      ],
      3,
      QUARTA,
    );
    // 3 dias (qua, qui, sex): só o almoço de seg–sex; a feijoada de sábado fica fora (nenhum dia da janela)
    expect(l).toEqual([{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 300, texto: '300 g' }] }]);
    expect(listaDeCompras([{ nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100, diasSemana: SEG_A_SEX }], 7, QUARTA)[0].itens[0].gramas).toBe(500);
  });
  it('dias: 1 a 14, inteiro; vazio = 7', () => {
    expect([lerDias(''), lerDias(undefined), lerDias('1'), lerDias('14'), lerDias('0'), lerDias('15'), lerDias('2.5'), lerDias('abc')]).toEqual([7, 7, 1, 14, null, null, null, null]);
  });
});
