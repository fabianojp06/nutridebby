import { describe, expect, it } from 'vitest';
import { lerValorLaudo } from './valor-laudo';

describe('lerValorLaudo (RN-111) — o número sai do sistema, nunca do modelo', () => {
  it.each([
    ['250.000', { tipo: 'ambiguo' }],
    // code review do PR #23 (item 4): vírgula + exatamente 3 dígitos, sem ponto, é milhar no padrão americano ou decimal
    ['250,000', { tipo: 'ambiguo' }],
    ['1,500', { tipo: 'ambiguo' }],
    ['-1,500', { tipo: 'ambiguo' }],
    ['1.250,000', { tipo: 'numero', valor: 1250 }],
    ['1,50', { tipo: 'numero', valor: 1.5 }],
    ['1,5000', { tipo: 'numero', valor: 1.5 }],
    ['7.500', { tipo: 'ambiguo' }],
    ['1.234,5', { tipo: 'numero', valor: 1234.5 }],
    ['0,85', { tipo: 'numero', valor: 0.85 }],
    ['12.5', { tipo: 'numero', valor: 12.5 }],
    ['1.234.567', { tipo: 'numero', valor: 1234567 }],
    ['< 0,5', { tipo: 'nao_numerico' }],
    ['>=10', { tipo: 'nao_numerico' }],
    ['≤ 3', { tipo: 'nao_numerico' }],
    ['Não reagente', { tipo: 'nao_numerico' }],
    ['Negativo', { tipo: 'nao_numerico' }],
    ['92', { tipo: 'numero', valor: 92 }],
    [' 92 ', { tipo: 'numero', valor: 92 }],
    ['-1,5', { tipo: 'numero', valor: -1.5 }],
    ['250000', { tipo: 'numero', valor: 250000 }],
    ['1234,5', { tipo: 'numero', valor: 1234.5 }],
    ['12.3456', { tipo: 'numero', valor: 12.3456 }],
    ['1.23.4', { tipo: 'nao_numerico' }],
    ['1,234.5', { tipo: 'nao_numerico' }],
    ['1,2,3', { tipo: 'nao_numerico' }],
    ['.5', { tipo: 'nao_numerico' }],
    ['', { tipo: 'nao_numerico' }],
    ['9'.repeat(20), { tipo: 'nao_numerico' }],
  ])('"%s" → %o', (texto, esperado) => {
    expect(lerValorLaudo(texto)).toEqual(esperado);
  });
});
