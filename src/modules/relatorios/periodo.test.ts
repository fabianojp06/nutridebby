import { describe, expect, it } from 'vitest';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_RELATORIOS } from './constantes';
import { limitesDoMes, mesNumerico, mesPorExtenso, opcoesDeMes, periodoDaUrl, textoMostrando } from './periodo';

const SP = 'America/Sao_Paulo';
const HOJE = '2026-11-17';
const sp = (q: Record<string, string>) => new URLSearchParams(q);
const PADRAO = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

/** RN-481 (US-486): meses inteiros, até 12, "De" ≤ "Até", sem mês futuro; inválido mostra o padrão e guarda a escolha. */
describe('periodoDaUrl', () => {
  it('sem parâmetros em 17/11/2026: de dezembro de 2025 a novembro de 2026, sem erro', () => {
    const r = periodoDaUrl(sp({}), HOJE, SP);
    expect(r).toEqual({ periodo: { de: '2025-12', ate: '2026-11', meses: PADRAO }, erro: null, escolhido: { de: '2025-12', ate: '2026-11' } });
  });

  it('período válido: os meses de "De" a "Até", inclusive; o mesmo mês vale', () => {
    expect(periodoDaUrl(sp({ de: '2026-03', ate: '2026-05' }), HOJE, SP)).toEqual({
      periodo: { de: '2026-03', ate: '2026-05', meses: ['2026-03', '2026-04', '2026-05'] },
      erro: null,
      escolhido: { de: '2026-03', ate: '2026-05' },
    });
    expect(periodoDaUrl(sp({ de: '2026-07', ate: '2026-07' }), HOJE, SP).periodo).toEqual({ de: '2026-07', ate: '2026-07', meses: ['2026-07'] });
  });

  it('"De" depois de "Até": erro "ordem", números do padrão e a escolha preservada', () => {
    const r = periodoDaUrl(sp({ de: '2026-06', ate: '2026-03' }), HOJE, SP);
    expect(r.erro).toBe('ordem');
    expect(r.periodo).toEqual({ de: '2025-12', ate: '2026-11', meses: PADRAO });
    expect(r.escolhido).toEqual({ de: '2026-06', ate: '2026-03' });
  });

  it('12 meses valem; 13 meses: erro "longo"', () => {
    expect(periodoDaUrl(sp({ de: '2025-01', ate: '2025-12' }), HOJE, SP).erro).toBeNull();
    const r = periodoDaUrl(sp({ de: '2025-01', ate: '2026-01' }), HOJE, SP);
    expect(r.erro).toBe('longo');
    expect(r.periodo.meses).toEqual(PADRAO);
    expect(r.escolhido).toEqual({ de: '2025-01', ate: '2026-01' });
  });

  it('texto inválido: erro "invalido", padrão, e a escolha ilegível vira null', () => {
    for (const q of [{ de: 'abc', ate: '2026-05' }, { de: '2026-13', ate: '2026-05' }, { de: '2026-3', ate: '2026-05' }, { de: '2026-03-01', ate: '2026-05' }, { de: '0999-01', ate: '2026-05' }]) {
      const r = periodoDaUrl(sp(q), HOJE, SP);
      expect(r.erro, JSON.stringify(q)).toBe('invalido');
      expect(r.periodo.meses).toEqual(PADRAO);
      expect(r.escolhido).toEqual({ de: null, ate: '2026-05' });
    }
  });

  it('mês futuro é recusado ("invalido"), em qualquer dos dois campos', () => {
    expect(periodoDaUrl(sp({ de: '2026-10', ate: '2026-12' }), HOJE, SP).erro).toBe('invalido');
    expect(periodoDaUrl(sp({ de: '2026-12', ate: '2026-12' }), HOJE, SP).erro).toBe('invalido');
    expect(periodoDaUrl(sp({ de: '2026-11', ate: '2026-11' }), HOJE, SP).erro).toBeNull();
  });

  it('só um dos campos: o outro fica com o do padrão', () => {
    expect(periodoDaUrl(sp({ de: '2026-09' }), HOJE, SP).periodo).toEqual({ de: '2026-09', ate: '2026-11', meses: ['2026-09', '2026-10', '2026-11'] });
    expect(periodoDaUrl(sp({ ate: '2026-02', de: '' }), HOJE, SP).periodo.de).toBe('2025-12');
  });

  it('virada do ano no fuso: 31/12 às 22h em São Paulo já é 1º/01 em UTC, e o padrão ainda termina em dezembro', () => {
    const agora = new Date('2027-01-01T01:00:00Z'); // 31/12/2026 22:00 em São Paulo
    const r = periodoDaUrl(sp({}), agora, SP);
    expect(r.periodo.de).toBe('2026-01');
    expect(r.periodo.ate).toBe('2026-12');
    expect(periodoDaUrl(sp({ de: '2027-01', ate: '2027-01' }), agora, SP).erro).toBe('invalido'); // janeiro ainda é futuro lá
    // a string de hoje já no fuso dá o mesmo
    expect(periodoDaUrl(sp({}), hojeNoFuso(SP, agora), SP)).toEqual(r);
  });

  it('virada do mês no fuso: 30/11 às 23h30 em São Paulo (02:30 de 01/12 em UTC) ainda é novembro', () => {
    const agora = new Date('2026-12-01T02:30:00Z');
    expect(periodoDaUrl(sp({}), agora, SP).periodo.ate).toBe('2026-11');
    expect(periodoDaUrl(sp({}), agora, 'UTC').periodo.ate).toBe('2026-12');
  });
});

describe('opcoesDeMes (RE-D48)', () => {
  it('primeiro cadastro em 09/2026: as opções começam em 12/2025 (o padrão sempre está na lista) e vão até o mês atual', () => {
    expect(opcoesDeMes('2026-09', HOJE)).toEqual(PADRAO);
    expect(opcoesDeMes('2026-09-14', HOJE)).toEqual(PADRAO);
  });

  it('primeiro cadastro em 2023: começa no mês do primeiro cadastro', () => {
    const o = opcoesDeMes('2023-04', HOJE);
    expect(o[0]).toBe('2023-04');
    expect(o.at(-1)).toBe('2026-11');
    expect(o).toHaveLength(44);
  });

  it('sem cadastro: os 12 meses do padrão; cadastro "no futuro" (relógio torto) não passa do mês atual', () => {
    expect(opcoesDeMes(null, HOJE)).toEqual(PADRAO);
    expect(opcoesDeMes('2027-02', HOJE)).toEqual(PADRAO);
  });
});

describe('limitesDoMes (no fuso do consultório)', () => {
  it('novembro de 2026 em São Paulo: de 01/11 00:00 a 01/12 00:00 locais (03:00 UTC)', () => {
    expect(limitesDoMes('2026-11', SP)).toEqual({ inicio: new Date('2026-11-01T03:00:00Z'), fim: new Date('2026-12-01T03:00:00Z') });
  });

  it('dezembro vira o ano: o fim é 1º de janeiro do ano seguinte', () => {
    expect(limitesDoMes('2026-12', SP)).toEqual({ inicio: new Date('2026-12-01T03:00:00Z'), fim: new Date('2027-01-01T03:00:00Z') });
  });

  it('com o relógio em UTC, um instante de 30/11 23:30 em São Paulo cai em novembro, não em dezembro', () => {
    const instante = new Date('2026-12-01T02:30:00Z');
    const nov = limitesDoMes('2026-11', SP);
    expect(instante >= nov.inicio && instante < nov.fim).toBe(true);
  });
});

describe('textos do período', () => {
  it('"Mostrando dezembro de 2025 a novembro de 2026."', () => {
    expect(mesPorExtenso('2025-12')).toBe('dezembro de 2025');
    expect(textoMostrando({ de: '2025-12', ate: '2026-11', meses: PADRAO })).toBe('Mostrando dezembro de 2025 a novembro de 2026.');
    expect(MSG_RELATORIOS.filtros.mostrando('dezembro de 2025', 'novembro de 2026')).toBe('Mostrando dezembro de 2025 a novembro de 2026.');
  });

  it('mês numérico do CSV e da impressão: mm/aaaa', () => {
    expect(mesNumerico('2026-03')).toBe('03/2026');
  });
});
