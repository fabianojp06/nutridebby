import { describe, expect, it } from 'vitest';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { diaDoAniversario, faixaDaGrade, gradeDoMes, lerVisao, nomeDoMesDoAno, periodoDaVisao, semanaDe } from './calendario';

/** Plano 23 (RN-411 a RN-413, AG-D14): calendário da agenda, puro (datas 'AAAA-MM-DD' já no fuso do consultório). */
const o = { comPaciente: false, hoje: '2026-11-17' };

describe('visão (RN-411)', () => {
  it('dia, semana, mês e lista; outro valor vira semana', () => {
    expect([lerVisao('dia'), lerVisao('semana'), lerVisao('mes'), lerVisao('lista')]).toEqual(['dia', 'semana', 'mes', 'lista']);
    expect([lerVisao('x'), lerVisao(undefined), lerVisao(['mes'])]).toEqual(['semana', 'semana', 'semana']);
  });
});

describe('semana', () => {
  it('de segunda a domingo, inclusive a que vira o mês e o ano', () => {
    expect(semanaDe('2026-11-17')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(semanaDe('2026-12-03')[0]).toBe('2026-11-30'); // vira o mês
    expect(semanaDe('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']); // vira o ano
    expect(semanaDe('2026-11-22')[0]).toBe('2026-11-16'); // o domingo fecha a semana
  });
  it('período: anterior e próximo andam 7 dias; de e até são o primeiro e o último dia', () => {
    expect(periodoDaVisao('semana', '2026-12-31', o)).toEqual({
      dias: semanaDe('2026-12-31'),
      de: '2026-12-28',
      ate: '2027-01-03',
      anterior: '2026-12-21',
      proximo: '2027-01-04',
    });
  });
});

describe('mês (RN-413)', () => {
  it('grade de segunda a domingo: fevereiro de 2027 começa numa segunda; novembro de 2026, em 26/10', () => {
    const fev = gradeDoMes('2027-02-10');
    expect(fev[0][0]).toBe('2027-02-01');
    expect(fev.at(-1)!.at(-1)).toBe('2027-02-28');
    expect(fev.every((s) => s.length === 7)).toBe(true);
    const nov = gradeDoMes('2026-11-17');
    expect(nov[0][0]).toBe('2026-10-26');
    expect(nov.at(-1)!.at(-1)).toBe('2026-12-06');
    expect(nov).toHaveLength(6);
    expect(gradeDoMes('2026-12-01')).toHaveLength(5); // 30/11 a 03/01
  });
  it('período do mês: só os dias do mês; anterior e próximo são o dia 1º dos meses vizinhos', () => {
    const p = periodoDaVisao('mes', '2026-12-17', o);
    expect([p.dias.length, p.de, p.ate, p.anterior, p.proximo]).toEqual([31, '2026-12-01', '2026-12-31', '2026-11-01', '2027-01-01']);
    expect(periodoDaVisao('mes', '2028-02-10', o).ate).toBe('2028-02-29');
    expect(nomeDoMesDoAno('2026-11-01')).toBe('novembro de 2026');
  });
  it('com o servidor em UTC e o relógio em 30/11 23:30 em São Paulo, "hoje" ainda é 30/11 e o mês é novembro', () => {
    const hoje = hojeNoFuso('America/Sao_Paulo', new Date('2026-12-01T02:30:00Z'));
    expect(hoje).toBe('2026-11-30');
    expect(periodoDaVisao('mes', hoje, { comPaciente: false, hoje }).de).toBe('2026-11-01');
    expect(periodoDaVisao('semana', hoje, { comPaciente: false, hoje }).de).toBe('2026-11-30');
  });
});

describe('dia e lista (RN-411)', () => {
  it('dia anda 1 dia; lista sem paciente = 30 dias a partir da data', () => {
    expect(periodoDaVisao('dia', '2026-12-31', o)).toEqual({ dias: ['2026-12-31'], de: '2026-12-31', ate: '2026-12-31', anterior: '2026-12-30', proximo: '2027-01-01' });
    const l = periodoDaVisao('lista', '2026-10-16', o);
    expect([l.dias.length, l.de, l.ate, l.anterior, l.proximo]).toEqual([30, '2026-10-16', '2026-11-14', '2026-09-16', '2026-11-15']);
  });
  it('lista com paciente: de hoje a hoje + 12 meses; "Anterior" recua 12 meses; "Próximo" não passa do teto da agenda', () => {
    const l = periodoDaVisao('lista', '2026-11-17', { comPaciente: true, hoje: '2026-11-17' });
    expect([l.de, l.ate, l.anterior, l.proximo]).toEqual(['2026-11-17', '2027-11-16', '2025-11-17', '2027-11-17']);
    expect(l.dias).toHaveLength(365);
    const teto = periodoDaVisao('lista', '2031-06-01', { comPaciente: true, hoje: '2026-11-17' });
    expect(teto.proximo).toBe('2031-11-17'); // hoje + 5 anos (dataDaAgendaOuHoje)
  });
});

describe('faixa da grade (RN-412)', () => {
  const regra = (diaSemana: number, inicio: string, fim: string) => ({ diaSemana, inicio, fim });
  const semana = semanaDe('2026-11-17');
  it('sem regra: 8h às 18h', () => {
    expect(faixaDaGrade([], semana, [], false)).toEqual({ de: 8, ate: 18 });
  });
  it('regras dos dias mostrados, arredondadas à hora: 07:30–19:15 → 7h às 20h', () => {
    expect(faixaDaGrade([regra(2, '07:30', '19:15')], semana, [], false)).toEqual({ de: 7, ate: 20 });
    // regra de um dia que não está na visão não conta (visão Dia de uma terça, regra de sábado)
    expect(faixaDaGrade([regra(6, '06:00', '22:00'), regra(2, '09:00', '12:00')], ['2026-11-17'], [], false)).toEqual({ de: 9, ate: 12 });
  });
  it('uma consulta fora da faixa amplia; "Mostrar 24 horas" vai de 0h a 24h', () => {
    expect(faixaDaGrade([regra(2, '08:00', '18:00')], semana, [{ inicioMin: 22 * 60, fimMin: 23 * 60 }], false)).toEqual({ de: 8, ate: 23 });
    expect(faixaDaGrade([], semana, [{ inicioMin: 6 * 60 + 30, fimMin: 7 * 60 + 10 }], false)).toEqual({ de: 6, ate: 18 });
    expect(faixaDaGrade([regra(2, '08:00', '18:00')], semana, [], true)).toEqual({ de: 0, ate: 24 });
  });
});

describe('aniversário (RN-414)', () => {
  it('29/02 vira 28/02 em ano não bissexto', () => {
    expect(diaDoAniversario('2000-02-29', 2027)).toBe('2027-02-28');
    expect(diaDoAniversario('2000-02-29', 2028)).toBe('2028-02-29');
    expect(diaDoAniversario('1991-03-10', 2026)).toBe('2026-03-10');
  });
});
