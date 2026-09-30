import { describe, expect, it } from 'vitest';
import { dataValida, formatarData, hojeNoFuso, idadeEm, somarAnos, somarDias } from './datas';

describe('datas do paciente (RN-06, RN-14, RN-17)', () => {
  it('dataValida aceita só AAAA-MM-DD que existe no calendário', () => {
    expect(dataValida('1991-03-10')).toBe(true);
    expect(dataValida('2024-02-29')).toBe(true);
    for (const d of ['2026-02-30', '2025-02-29', '10/03/1991', '1991-3-10', '1899-12-31', '', 'amanhã']) expect(dataValida(d), d).toBe(false);
  });
  it('idadeEm conta anos completos; 29/02 completa ano em 01/03 nos anos comuns', () => {
    expect(idadeEm('1991-03-10', '2026-03-09')).toBe(34);
    expect(idadeEm('1991-03-10', '2026-03-10')).toBe(35);
    expect(idadeEm('2004-02-29', '2022-02-28')).toBe(17);
    expect(idadeEm('2004-02-29', '2022-03-01')).toBe(18);
  });
  it('hojeNoFuso usa o fuso do tenant: 23h30 em São Paulo ainda é o dia anterior ao UTC (Review Focus 1)', () => {
    expect(hojeNoFuso('America/Sao_Paulo', new Date('2026-03-10T02:30:00Z'))).toBe('2026-03-09');
    expect(hojeNoFuso('America/Sao_Paulo', new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-10');
    expect(hojeNoFuso('America/Manaus', new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-09');
  });
  it('formatarData exibe dd/mm/aaaa (RNF-12)', () => {
    expect(formatarData('2026-09-01')).toBe('01/09/2026');
  });
});

describe('somarAnos / somarDias', () => {
  it('prazo de guarda e de resposta; 29/02 vira 28/02 em ano comum', () => {
    expect(somarAnos('2026-09-15', 20)).toBe('2046-09-15');
    expect(somarAnos('2024-02-29', 1)).toBe('2025-02-28');
    expect(somarDias('2026-10-01', 15)).toBe('2026-10-16');
    expect(somarDias('2026-12-25', 10)).toBe('2027-01-04');
  });
});
