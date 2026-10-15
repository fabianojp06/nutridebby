import { describe, expect, it } from 'vitest';
import { perguntaComCondicao, temTermo, TERMOS_SENSIVEIS, termosNaPergunta } from './termos-sensiveis';

describe('perguntaComCondicao (RN-175, §5.2, Review Focus 4): "posso X se tenho/estou Y"', () => {
  it.each([
    'posso comer o lanche da tarde mesmo com diarreia?',
    'posso tomar o whey estando grávida?',
    'posso comer a ceia mesmo com dores de cabeça?',
    'posso comer pão se a barriga dói?',
    // revisão da T6 (rodada 1): outras formas de pedir permissão e outros marcadores de condição
    'faz mal comer banana com gastrite?',
    'é seguro comer peixe estando grávida?',
    'posso comer pão com doença celíaca?',
    'tudo bem jantar com cólica?',
    'tem perigo tomar leite com intolerância à lactose?',
    'posso comer doce se uso insulina?',
  ])('com condição: %s', (p) => expect(perguntaComCondicao(p)).toBe(true));

  it.each([
    'posso trocar a banana pela maçã?',
    'posso comer a ceia antes de dormir?', // "dor" não casa "dormir"
    'quanto de arroz eu como com diarreia?', // sem pedido de permissão: o modelo classifica, a defesa a mais não atua
  ])('sem condição (ou sem permissão): %s', (p) => expect(perguntaComCondicao(p)).toBe(false));
});

describe('termos sensíveis (RN-176, D25 = b)', () => {
  it('a lista vem sem acento e em minúsculas (o texto é comparado normalizado)', () => {
    for (const t of TERMOS_SENSIVEIS) expect(t).toBe(t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
  });

  it('termosNaPergunta: o termo, o plural e números colados; nunca dentro de outra palavra', () => {
    expect(termosNaPergunta('quanto de whey eu tomo depois do treino?')).toEqual(['whey']);
    expect(termosNaPergunta('posso tomar vitamina D3 junto do café?')).toEqual(['vitamina d']);
    expect(termosNaPergunta('posso tomar ômega-3?')).toEqual(['omega 3']);
    expect(termosNaPergunta('quais suplementos eu tomo?')).toEqual(['suplemento']);
    expect(termosNaPergunta('quantas cápsulas de vitamina D3?')).toEqual(['capsula', 'vitamina d']);
    expect(termosNaPergunta('posso trocar a banana pela maçã?')).toEqual([]);
  });

  it('temTermo: o trecho citado tem o termo (sem acento, hífen como espaço)', () => {
    expect(temTermo('Whey protein — 30 g', 'whey')).toBe(true);
    expect(temTermo('Vitamina D3 — 1 cápsula', 'vitamina d')).toBe(true);
    expect(temTermo('Ômega-3 — 1 cápsula', 'omega 3')).toBe(true);
    expect(temTermo('a vitamina de banana leva leite?', 'vitamina d')).toBe(false);
    expect(temTermo('suplementação', 'suplemento')).toBe(false);
  });
});
