import { describe, expect, it } from 'vitest';
import { diasEntre, intervaloDoMes, mesDe, mesesDoAno, nomeDoMes, periodoValido, ultimos12Meses } from './meses';

/** Datas 'AAAA-MM-DD' e meses 'AAAA-MM' do calendário do consultório: nada depende do fuso do servidor. */
describe('meses', () => {
  it('mesDe', () => {
    expect(mesDe('2026-11-16')).toBe('2026-11');
    expect(mesDe('2026-01-01')).toBe('2026-01');
  });

  it('intervaloDoMes: fevereiro de 2028 (bissexto), de 2026 e de 2100; meses de 30 e 31 dias', () => {
    expect(intervaloDoMes('2028-02')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
    expect(intervaloDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
    expect(intervaloDoMes('2100-02')).toEqual({ de: '2100-02-01', ate: '2100-02-28' });
    expect(intervaloDoMes('2000-02')).toEqual({ de: '2000-02-01', ate: '2000-02-29' });
    expect(intervaloDoMes('2026-11')).toEqual({ de: '2026-11-01', ate: '2026-11-30' });
    expect(intervaloDoMes('2026-12')).toEqual({ de: '2026-12-01', ate: '2026-12-31' });
  });

  it('mesesDoAno', () => {
    const m = mesesDoAno(2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2026-01');
    expect(m[11]).toBe('2026-12');
  });

  it("ultimos12Meses('2026-11-16') começa em 2025-12 e termina no mês de hoje", () => {
    expect(ultimos12Meses('2026-11-16')).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ]);
    expect(ultimos12Meses('2026-12-31')[0]).toBe('2026-01');
    expect(ultimos12Meses('2026-01-01')[0]).toBe('2025-02');
    expect(ultimos12Meses('2026-01-01')[11]).toBe('2026-01');
  });

  it('nomeDoMes', () => {
    expect(nomeDoMes('2026-11')).toBe('novembro');
    expect(nomeDoMes('2026-03')).toBe('março');
    expect(mesesDoAno(2026).map(nomeDoMes)).toEqual([
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ]);
  });

  it('diasEntre: ate − de, em dias de calendário (sem horário de verão no meio)', () => {
    expect(diasEntre('2026-11-01', '2026-11-01')).toBe(0);
    expect(diasEntre('2026-11-01', '2026-11-30')).toBe(29);
    expect(diasEntre('2026-01-01', '2026-12-31')).toBe(364);
    expect(diasEntre('2028-01-01', '2028-12-31')).toBe(365);
    expect(diasEntre('2026-10-31', '2026-11-02')).toBe(2);
    expect(diasEntre('2026-11-02', '2026-10-31')).toBe(-2);
  });

  it('periodoValido (RN-321): datas que existem, "De" ≤ "Até" e até 366 dias contando as duas pontas; nunca lança', () => {
    expect(periodoValido('2026-11-01', '2026-11-30')).toBe(true);
    expect(periodoValido('2026-11-16', '2026-11-16')).toBe(true);
    expect(periodoValido('2025-11-01', '2026-11-01')).toBe(true); // 366 dias
    expect(periodoValido('2025-11-01', '2026-11-02')).toBe(false); // 367 dias
    expect(periodoValido('2027-03-01', '2028-02-29')).toBe(true); // 366 dias com 29/02
    expect(periodoValido('2026-11-30', '2026-11-01')).toBe(false);
    expect(periodoValido('2026-02-30', '2026-03-01')).toBe(false);
    expect(periodoValido('', '2026-11-01')).toBe(false);
    expect(periodoValido('16/11/2026', '2026-11-30')).toBe(false);
  });

  it('formato inválido é erro de programação (as rotas validam antes)', () => {
    expect(() => intervaloDoMes('2026-13')).toThrow(RangeError);
    expect(() => diasEntre('16/11/2026', '2026-11-16')).toThrow(RangeError);
    expect(() => ultimos12Meses('2026-11')).toThrow(RangeError);
  });
});
