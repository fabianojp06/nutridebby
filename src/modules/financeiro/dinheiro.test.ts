import { describe, expect, it } from 'vitest';
import { centavos, formatarReais, paraCentavos, valorParaCampo } from './dinheiro';

/** RN-326: entrada em reais na forma brasileira, sem ponto flutuante; tela "R$ 1.250,00" e "−R$ 320,00". */
describe('paraCentavos', () => {
  it.each([
    ['1250', 125_000],
    ['1250,5', 125_050],
    ['1250,50', 125_050],
    ['1.250,50', 125_050],
    ['R$ 1.250,50', 125_050],
    ['R$1.250,50', 125_050],
    ['R$ 1.250,50', 125_050], // o que o próprio formatarReais escreve (espaço não separável)
    ['  250,00  ', 25_000],
    ['0,01', 1],
    ['1.000.000,00', 100_000_000],
    ['-320,00', -32_000],
    ['−320,00', -32_000],
    ['−R$ 320,00', -32_000],
    ['R$ -320,00', -32_000],
    ['-10.000.000,00', -1_000_000_000],
    ['1.250', 125_000], // ponto de milhar
  ])('%j → %i centavos', (texto, centavos) => {
    expect(paraCentavos(texto)).toEqual({ ok: true, centavos });
  });

  it('"-0,00" vira 0 (sem −0)', () => {
    const r = paraCentavos('-0,00');
    expect(r.ok && Object.is(r.centavos, 0)).toBe(true);
  });

  it.each(['', '   ', '\t'])('%j → vazio', (texto) => {
    expect(paraCentavos(texto)).toEqual({ ok: false, erro: 'vazio' });
  });

  it.each([
    '1,2,3',
    'abc',
    '1.25', // ponto como decimal
    '1250.50',
    '12,345', // mais de 2 casas
    '1,',
    ',50',
    '12.34,00', // grupo de milhar com 2 dígitos
    '1.2345,00',
    'R$',
    '--1',
    '+1',
    '1e3',
    '1 250,00',
    '12a',
    '١٢', // dígitos de outro alfabeto
    '99999999999999,00', // além do que um inteiro seguro guarda
  ])('%j → inválido', (texto) => {
    expect(paraCentavos(texto)).toEqual({ ok: false, erro: 'invalido' });
  });
});

describe('formatarReais', () => {
  it.each([
    [125_000, 'R$ 1.250,00'],
    [1, 'R$ 0,01'],
    [0, 'R$ 0,00'],
    [100_000_000, 'R$ 1.000.000,00'],
    [-32_000, '−R$ 320,00'],
    [-1, '−R$ 0,01'],
  ])('%i → %j', (centavos, texto) => {
    expect(formatarReais(centavos)).toBe(texto);
  });

  it('volta pelo paraCentavos', () => {
    for (const c of [1, 99, 125_050, -32_000, 1_000_000_000, -1_000_000_000]) expect(paraCentavos(formatarReais(c))).toEqual({ ok: true, centavos: c });
  });
});

/** O valor salvo de volta no campo do formulário (Configurações, edição): sem "R$", com o "-" do teclado. */
describe('valorParaCampo', () => {
  it.each([
    [150_000, '1.500,00'],
    [25_000, '250,00'],
    [1, '0,01'],
    [-32_000, '-320,00'],
    [1_000_000_000, '10.000.000,00'],
  ])('%i → %j', (centavos, texto) => {
    expect(valorParaCampo(centavos)).toBe(texto);
    expect(paraCentavos(texto)).toEqual({ ok: true, centavos });
  });
});

/** RNF-304: a soma em `bigint` do banco (texto) vira `number` só se couber sem perda. */
describe('centavos', () => {
  it('texto, número e nulo; fora do inteiro seguro → RangeError', () => {
    expect(centavos('125050')).toBe(125_050);
    expect(centavos('-500')).toBe(-500);
    expect(centavos(42)).toBe(42);
    expect(centavos(null)).toBe(0);
    expect(centavos(undefined)).toBe(0);
    expect(centavos(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => centavos('9007199254740993')).toThrow(RangeError);
  });
});
