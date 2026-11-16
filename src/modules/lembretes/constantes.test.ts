import { describe, expect, it } from 'vitest';
import { rotuloDaAntecedencia, rotuloDoDiario, rotuloDoIntervalo, rotuloDosDias } from './constantes';

describe('formatadores dos lembretes (painel e portal)', () => {
  it('rotuloDoIntervalo', () => {
    expect(rotuloDoIntervalo(60)).toBe('1 h');
    expect(rotuloDoIntervalo(90)).toBe('1h30');
    expect(rotuloDoIntervalo(120)).toBe('2 h');
    expect(rotuloDoIntervalo(180)).toBe('3 h');
    expect(rotuloDoIntervalo(240)).toBe('4 h');
  });

  it('rotuloDosDias', () => {
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5, 6])).toBe('todos os dias');
    expect(rotuloDosDias([6, 5, 4, 3, 2, 1, 0])).toBe('todos os dias');
    expect(rotuloDosDias([1, 2, 3, 4, 5])).toBe('seg a sex');
    expect(rotuloDosDias([0, 6])).toBe('sáb e dom');
    expect(rotuloDosDias([5, 1, 3])).toBe('seg, qua e sex');
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5])).toBe('seg, ter, qua, qui, sex e dom');
    expect(rotuloDosDias([1, 2, 3, 4, 5, 6])).toBe('seg, ter, qua, qui, sex e sáb');
    expect(rotuloDosDias([3])).toBe('qua');
  });

  it('rotuloDaAntecedencia', () => {
    expect(rotuloDaAntecedencia(0)).toBe('na hora');
    expect(rotuloDaAntecedencia(15)).toBe('15 min antes');
    expect(rotuloDaAntecedencia(30)).toBe('30 min antes');
  });

  it('rotuloDoDiario', () => {
    expect(rotuloDoDiario(null)).toBe('sem pedido de registro');
    expect(rotuloDoDiario(30)).toBe('pedir registro no diário 30 min depois');
    expect(rotuloDoDiario(60)).toBe('pedir registro no diário 60 min depois');
  });
});
