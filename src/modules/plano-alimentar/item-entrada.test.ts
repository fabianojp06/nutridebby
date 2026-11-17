import { describe, expect, it } from 'vitest';
import { MSG_PLANO } from './constantes';
import { lerCamposDoItem, lerItem } from './item-entrada';

// RN-250/RN-251: uma leitura só do item para o rascunho (`salvarRascunho`) e a biblioteca ("Minhas refeições", listas);
// a revisão da T8 (rodada 1) achou duas cópias que podiam divergir sem teste nenhum acusar.
const ID = '00000000-0000-4000-8000-000000000001';
const FOOD = '00000000-0000-4000-8000-000000000002';
const MEDIDA = { nome: 'colher de sopa', plural: 'colheres de sopa', gramas: 25, qtd: 2 };

function ler(i: Record<string, unknown>) {
  const erros: Record<string, string> = {};
  const errosBiblioteca: Record<string, string> = {};
  const leitura = lerCamposDoItem({ id: ID, ...i }, erros);
  const item = lerItem({ id: ID, ...i }, errosBiblioteca);
  expect(errosBiblioteca).toEqual(erros); // a biblioteca e o rascunho devolvem as mesmas chaves e mensagens
  return { leitura, item, erros };
}

describe('item-entrada: a leitura do item do editor (rascunho e biblioteca)', () => {
  it('gramas: arredonda em 2 casas (numeric(7,2)) e aceita vírgula', () => {
    const { item, erros } = ler({ foodId: FOOD, quantidadeG: '150,456', medida: null });
    expect(erros).toEqual({});
    expect(item).toEqual({ chave: `item:${ID}`, foodId: FOOD, quantidadeG: 150.46, medida: null });
  });

  it('medida caseira: gramas = quantidade × gramas da medida', () => {
    const { item, erros } = ler({ foodId: FOOD, quantidadeG: 1, medida: MEDIDA });
    expect(erros).toEqual({});
    expect(item).toEqual({ chave: `item:${ID}`, foodId: FOOD, quantidadeG: 50, medida: MEDIDA });
  });

  it.each([
    ['gramas abaixo de 0,1', { foodId: FOOD, quantidadeG: 0.05 }, { [`item:${ID}:quantidadeG`]: MSG_PLANO.quantidade }],
    ['gramas acima de 5000', { foodId: FOOD, quantidadeG: 5000.5 }, { [`item:${ID}:quantidadeG`]: MSG_PLANO.quantidade }],
    ['gramas em branco', { foodId: FOOD, quantidadeG: '' }, { [`item:${ID}:quantidadeG`]: MSG_PLANO.quantidade }],
    ['medida fora do formato (só o erro da medida)', { foodId: FOOD, medida: { ...MEDIDA, gramas: 0 } }, { [`item:${ID}:medida`]: MSG_PLANO.quantidade }],
    ['medida que passa de 5000 g', { foodId: FOOD, medida: { ...MEDIDA, gramas: 5000, qtd: 2 } }, { [`item:${ID}:quantidadeG`]: MSG_PLANO.quantidade }],
    ['alimento fora do formato', { foodId: 'x', quantidadeG: 100 }, { [`item:${ID}:foodId`]: MSG_PLANO.alimento }],
    [
      'alimento e medida com erro',
      { foodId: 1, medida: { nome: '' } },
      { [`item:${ID}:foodId`]: MSG_PLANO.alimento, [`item:${ID}:medida`]: MSG_PLANO.quantidade },
    ],
  ])('%s: erro na chave do editor e o item fica de fora da biblioteca', (_, entrada, esperado) => {
    const { leitura, item, erros } = ler(entrada);
    expect(erros).toEqual(esperado);
    expect(leitura.valido).toBe(false);
    expect(item).toBeNull();
  });

  it('o rascunho recebe a quantidade válida mesmo com o alimento em erro (o item segue na lista até o PlanoError)', () => {
    const { leitura } = ler({ foodId: 'x', quantidadeG: 100 });
    expect(leitura).toMatchObject({ quantidadeG: 100, medida: null, valido: false });
  });
});
