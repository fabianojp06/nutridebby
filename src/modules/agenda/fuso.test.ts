import { describe, expect, it } from 'vitest';
import { diaCurto, diaDaSemana, formatarQuando, inicioDoDia, inicioDoMes, inicioDoMesSeguinte, paraInstante, partesNoFuso, quandoComFuso, rotuloDoFuso, segundaDaSemana } from './fuso';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';

describe('fuso do tenant (RN-06)', () => {
  it('data + hora de Brasília viram o instante UTC certo, e voltam', () => {
    expect(paraInstante('2026-10-16', '14:00', SP)?.toISOString()).toBe('2026-10-16T17:00:00.000Z');
    expect(partesNoFuso(new Date('2026-10-16T17:00:00Z'), SP)).toEqual({ data: '2026-10-16', hora: '14:00', diaSemana: 5, minutos: 840 });
    // 23:30 de Brasília ainda é o dia 15, embora no UTC já seja 16
    expect(partesNoFuso(new Date('2026-10-16T02:30:00Z'), SP).data).toBe('2026-10-15');
  });

  it('dia da semana pelo calendário, sem depender do fuso do servidor', () => {
    expect([diaDaSemana('2026-10-18'), diaDaSemana('2026-10-20'), diaDaSemana('2026-10-24')]).toEqual([0, 2, 6]);
  });

  it('segunda-feira da semana (a agenda começa na segunda): domingo volta 6 dias, segunda fica, virada de mês e de ano', () => {
    expect(segundaDaSemana('2026-10-19')).toBe('2026-10-19'); // segunda
    expect(segundaDaSemana('2026-10-21')).toBe('2026-10-19'); // quarta
    expect(segundaDaSemana('2026-10-25')).toBe('2026-10-19'); // domingo fecha a semana, não abre a seguinte
    expect(segundaDaSemana('2026-11-01')).toBe('2026-10-26'); // domingo no mês seguinte à segunda
    expect(segundaDaSemana('2027-01-01')).toBe('2026-12-28'); // sexta, segunda no ano anterior
  });

  it('horário de verão: hora que não existe → null; hora repetida → a primeira; meia-noite que não existe → 01:00', () => {
    expect(paraInstante('2026-03-08', '02:30', NY)).toBeNull();
    expect(paraInstante('2026-11-01', '01:30', NY)?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(paraInstante('2026-07-01', '09:00', NY)?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    // Brasília teve horário de verão até 2019: 04/11/2018 começou às 01:00
    expect(paraInstante('2018-11-04', '00:00', SP)).toBeNull();
    expect(inicioDoDia('2018-11-04', SP).toISOString()).toBe('2018-11-04T03:00:00.000Z');
  });

  it('virada do mês no fuso (RN-09): 31/10 23:30 em Brasília ainda é outubro', () => {
    expect(inicioDoMes(new Date('2026-11-01T02:30:00Z'), SP).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(inicioDoMesSeguinte(new Date('2026-11-01T02:30:00Z'), SP).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(inicioDoMesSeguinte(new Date('2026-12-15T12:00:00Z'), SP).toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('textos: "sex., 16/10/2026 às 14:00 (horário de Brasília)" e "sex., 16/10"', () => {
    const i = new Date('2026-10-16T17:00:00Z');
    expect(formatarQuando(i, SP)).toBe('sex., 16/10/2026 às 14:00');
    expect(rotuloDoFuso(SP)).toBe('horário de Brasília');
    expect(quandoComFuso(i, SP)).toBe('sex., 16/10/2026 às 14:00 (horário de Brasília)');
    expect(diaCurto('2026-10-16')).toBe('sex., 16/10');
    expect(rotuloDoFuso('America/Manaus')).toMatch(/^horário/);
  });
});
