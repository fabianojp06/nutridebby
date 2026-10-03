import { describe, expect, it } from 'vitest';
import { lerDias, listaDeCompras, quantidadeTexto } from './lista-compras';

describe('lista de compras (RN-13)', () => {
  it('"Arroz, tipo 1, cozido" 100 g no almoço e no jantar × 7 dias = 1,4 kg em "Cereais e derivados"', () => {
    const l = listaDeCompras(
      [
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100 },
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100 },
        { nome: 'Chuchu, cozido', grupo: 'Verduras, hortaliças e derivados', quantidadeG: 80 },
      ],
      7,
    );
    expect(l).toEqual([
      { grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 1400, texto: '1,4 kg' }] },
      { grupo: 'Verduras, hortaliças e derivados', itens: [{ nome: 'Chuchu, cozido', gramas: 560, texto: '560 g' }] },
    ]);
  });
  it('g abaixo de 1000, kg com 1 casa a partir de 1000; grupos na ordem da TACO, itens em ordem alfabética', () => {
    expect([quantidadeTexto(999), quantidadeTexto(1000), quantidadeTexto(12.5), quantidadeTexto(1060)]).toEqual(['999 g', '1,0 kg', '12,5 g', '1,1 kg']);
    const l = listaDeCompras([{ nome: 'Ovo', grupo: 'Ovos e derivados', quantidadeG: 50 }, { nome: 'Banana', grupo: 'Frutas e derivados', quantidadeG: 50 }, { nome: 'Abacate', grupo: 'Frutas e derivados', quantidadeG: 50 }], 1);
    expect(l.map((g) => g.grupo)).toEqual(['Frutas e derivados', 'Ovos e derivados']);
    expect(l[0].itens.map((i) => i.nome)).toEqual(['Abacate', 'Banana']);
  });
  it('dias: 1 a 14, inteiro; vazio = 7', () => {
    expect([lerDias(''), lerDias(undefined), lerDias('1'), lerDias('14'), lerDias('0'), lerDias('15'), lerDias('2.5'), lerDias('abc')]).toEqual([7, 7, 1, 14, null, null, null, null]);
  });
});
