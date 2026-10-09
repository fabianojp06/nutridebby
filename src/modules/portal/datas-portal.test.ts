import { describe, expect, it } from 'vitest';
import { daquiA, dataDaFaixa, dataPorExtenso, horaComFuso, mesPorExtenso, quandoRelativo, quandoRelativoComFuso, separadorDoDia } from './datas-portal';

const SP = 'America/Sao_Paulo';

describe('datas do portal (RN-217)', () => {
  it('faixa de Hoje: "Quinta, 8 out"; separador: "Ontem" e "Ter, 6 out"', () => {
    expect(dataDaFaixa('2026-10-08')).toBe('Quinta, 8 out');
    expect(separadorDoDia('2026-10-07', '2026-10-08')).toBe('Ontem');
    expect(separadorDoDia('2026-10-06', '2026-10-08')).toBe('Ter, 6 out');
    expect(separadorDoDia('2026-09-30', '2026-10-01')).toBe('Ontem'); // virada do mês
  });

  it('Jornada: "22 de setembro" no ano corrente; com o ano quando é outro (Desvio 7)', () => {
    expect(dataPorExtenso('2026-09-22', '2026-10-08')).toBe('22 de setembro');
    expect(dataPorExtenso('2025-03-18', '2026-10-08')).toBe('18 de março de 2025');
    expect(mesPorExtenso('2026-03-18', '2026-10-08')).toBe('março');
    expect(mesPorExtenso('2025-12-02', '2026-10-08')).toBe('dezembro de 2025');
  });

  it('consulta: hoje, amanhã ou o dia curto, no fuso do consultório (servidor em UTC); com a sigla quando pedida', () => {
    const agora = new Date('2026-10-08T14:05:00Z'); // 11:05 em São Paulo
    expect(quandoRelativo(new Date('2026-10-08T20:00:00Z'), agora, SP)).toBe('hoje, 17:00');
    expect(quandoRelativo(new Date('2026-10-09T17:00:00Z'), agora, SP)).toBe('amanhã, 14:00');
    // 00:30 de sexta em SP ainda é quinta 03:30 UTC… e vice-versa: o dia é sempre o do fuso
    expect(quandoRelativo(new Date('2026-10-09T03:30:00Z'), agora, SP)).toBe('amanhã, 00:30');
    expect(quandoRelativo(new Date('2026-10-16T17:00:00Z'), agora, SP)).toBe('sex., 16/10, 14:00');
    expect(quandoRelativoComFuso(new Date('2026-10-09T17:00:00Z'), agora, SP)).toBe('amanhã, 14:00 (horário de Brasília)');
    expect(horaComFuso(new Date('2026-10-08T12:15:00Z'), SP)).toEqual({ semFuso: '09:15', comFuso: '09:15 (horário de Brasília)' });
  });

  it('"daqui a": horas e minutos, sem "0 h"', () => {
    expect(daquiA(85)).toBe('daqui a 1 h 25 min');
    expect(daquiA(40)).toBe('daqui a 40 min');
    expect(daquiA(120)).toBe('daqui a 2 h');
    expect(daquiA(0)).toBe('agora');
  });
});
