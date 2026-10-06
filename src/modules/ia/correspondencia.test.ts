import { describe, expect, it } from 'vitest';
import { jaLancado, nomeDaSerie, normalizarNome, SINONIMOS } from './correspondencia';

const series = [
  { nome: 'Glicemia de jejum', unidade: 'mg/dL', pontos: [] },
  { nome: 'AST', unidade: 'U/L', pontos: [] },
  { nome: 'Colesterol total', unidade: 'mg/dL', pontos: [] },
];

describe('correspondência de nomes (RN-113) — sem enviar a lista à IA', () => {
  it('normaliza acento, maiúsculas e pontuação', () => {
    expect(normalizarNome('  Glicose  de Jejum.')).toBe('glicose de jejum');
    expect(normalizarNome('Hormônio Tireoestimulante (TSH)')).toBe('hormonio tireoestimulante tsh');
  });

  it('sinônimo com a mesma unidade → nome da série existente; mesmo nome → null (nada a ajustar)', () => {
    expect(nomeDaSerie('Glicose de jejum', 'mg/dL', series)).toBe('Glicemia de jejum');
    expect(nomeDaSerie('TGO', 'U/L', series)).toBe('AST');
    expect(nomeDaSerie('colesterol TOTAL', 'mg/dL', series)).toBe('Colesterol total');
    expect(nomeDaSerie('Glicemia de jejum', 'mg/dL', series)).toBeNull();
  });

  it('unidade diferente não ajusta (mmol/L é outra série); sem série parecida → null', () => {
    expect(nomeDaSerie('Glicose de jejum', 'mmol/L', series)).toBeNull();
    expect(nomeDaSerie('Ferritina', 'ng/mL', series)).toBeNull();
    expect(nomeDaSerie('Glicose de jejum', null, series)).toBe('Glicemia de jejum');
  });

  it('SINONIMOS (revisada pela Debby, D15): cada nome já normalizado e em um grupo só', () => {
    const todos = SINONIMOS.flat();
    for (const nome of todos) expect(normalizarNome(nome)).toBe(nome);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('"Já lançado": mesmo nome normalizado, mesmo valor e mesma unidade', () => {
    const valores = [{ nome: 'Colesterol total', valor: 190, unidade: 'mg/dL', referencia: null }];
    expect(jaLancado(valores, 'COLESTEROL TOTAL', 190, 'mg/dl')).toBe(true);
    expect(jaLancado(valores, 'Colesterol total', 191, 'mg/dL')).toBe(false);
  });
});
