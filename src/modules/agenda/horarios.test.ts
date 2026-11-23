import { describe, expect, it } from 'vitest';
import { paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, HORA_HHMM, horariosVisiveis, minutosDe, type Regra, sobrepoe, textoAparado } from './horarios';

const SP = 'America/Sao_Paulo';
const em = (data: string, hora: string) => paraInstante(data, hora, SP)!;
const rotulos = (hs: { inicio: Date }[]) => hs.map((h) => { const p = partesNoFuso(h.inicio, SP); return `${p.data} ${p.hora}`; });
const TERCA: Regra = { diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'presencial' };
const semana = { de: em('2026-10-19', '00:00'), ate: em('2026-10-26', '00:00'), fuso: SP };

describe('gerarHorarios (RN-03, US-030)', () => {
  it('"terça, 08:00–12:00, 60 min, presencial" → 08:00, 09:00, 10:00 e 11:00', () => {
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, online: false });
    expect(rotulos(hs)).toEqual(['2026-10-20 08:00', '2026-10-20 09:00', '2026-10-20 10:00', '2026-10-20 11:00']);
    expect(hs[0].modalidades).toEqual(['presencial']);
    expect(hs[0].fim.getTime() - hs[0].inicio.getTime()).toBe(60 * 60_000);
  });

  it('bloqueio de 20/10 a 24/10 ("Congresso") tira todos os horários desses dias', () => {
    const bloqueio = { inicio: em('2026-10-20', '00:00'), fim: em('2026-10-25', '00:00') };
    expect(gerarHorarios({ regras: [TERCA], bloqueios: [bloqueio], ocupados: [], ...semana, online: false })).toEqual([]);
  });

  it('consulta não cancelada ocupa o horário, inclusive em parte (09:30–10:30 tira 09:00 e 10:00)', () => {
    const ocupado = { inicio: em('2026-10-20', '09:30'), fim: em('2026-10-20', '10:30') };
    expect(rotulos(gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [ocupado], ...semana, online: false }))).toEqual(['2026-10-20 08:00', '2026-10-20 11:00']);
  });

  it('US-032: às 10:00 de 14/10, com antecedência de 12 h, o primeiro horário é 22:00 de 14/10; nada depois de 60 dias', () => {
    const quarta: Regra = { diaSemana: 3, inicio: '08:00', fim: '23:00', duracaoMin: 60, modalidade: 'ambas' };
    const agora = em('2026-10-14', '10:00');
    const hs = gerarHorarios({ regras: [quarta], bloqueios: [], ocupados: [], de: new Date(agora.getTime() + 12 * 3_600_000), ate: new Date(agora.getTime() + 60 * 86_400_000), fuso: SP, online: false });
    expect(rotulos(hs)[0]).toBe('2026-10-14 22:00');
    expect(partesNoFuso(hs.at(-1)!.inicio, SP).data).toBe('2026-12-09');
    expect(hs[0].modalidades).toEqual(['presencial']); // sem link padrão, "ambas" só oferece presencial (US-031)
  });

  it('regra só online sem link padrão não oferece nada; com link, oferece', () => {
    const online: Regra = { diaSemana: 2, inicio: '08:00', fim: '10:00', duracaoMin: 30, modalidade: 'online' };
    expect(gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, online: false })).toEqual([]);
    expect(gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, online: true }).map((h) => h.modalidades)).toEqual([['online'], ['online'], ['online'], ['online']]);
  });

  it('AG-D47 (Plano 23, PR 1): gerarHorarios junta presencial e online do mesmo início e fim num horário com as duas modalidades', () => {
    // o backfill desdobra "ambas" em uma regra presencial e uma online, com os mesmos horários
    const presencial: Regra = { ...TERCA, modalidade: 'presencial' };
    const online: Regra = { ...TERCA, modalidade: 'online' };
    const juntos = gerarHorarios({ regras: [online, presencial], bloqueios: [], ocupados: [], ...semana, online: true });
    const ambas = gerarHorarios({ regras: [{ ...TERCA, modalidade: 'ambas' }], bloqueios: [], ocupados: [], ...semana, online: true });
    expect(juntos).toEqual(ambas);
    expect(rotulos(juntos)).toEqual(['2026-10-20 08:00', '2026-10-20 09:00', '2026-10-20 10:00', '2026-10-20 11:00']);
    expect(juntos.map((h) => h.modalidades)).toEqual(Array(4).fill(['presencial', 'online']));
    // sem link padrão, a regra online não oferece nada e o horário fica só presencial
    expect(gerarHorarios({ regras: [online, presencial], bloqueios: [], ocupados: [], ...semana, online: false }).map((h) => h.modalidades)).toEqual(Array(4).fill(['presencial']));
    // mesmo início com fim diferente (outra duração) não junta
    const curta: Regra = { ...TERCA, fim: '09:00', duracaoMin: 30, modalidade: 'online' };
    const hs = gerarHorarios({ regras: [presencial, curta], bloqueios: [], ocupados: [], ...semana, online: true });
    expect(hs.slice(0, 3).map((h) => [rotulos([h])[0], (h.fim.getTime() - h.inicio.getTime()) / 60_000, h.modalidades])).toEqual([
      ['2026-10-20 08:00', 60, ['presencial']],
      ['2026-10-20 08:00', 30, ['online']],
      ['2026-10-20 08:30', 30, ['online']],
    ]);
  });

  it('horário de verão: a hora que não existe é pulada', () => {
    const NY = 'America/New_York';
    const domingo: Regra = { diaSemana: 0, inicio: '01:00', fim: '04:00', duracaoMin: 60, modalidade: 'presencial' };
    const hs = gerarHorarios({ regras: [domingo], bloqueios: [], ocupados: [], de: paraInstante('2026-03-08', '00:00', NY)!, ate: paraInstante('2026-03-09', '00:00', NY)!, fuso: NY, online: false });
    expect(hs.map((h) => partesNoFuso(h.inicio, NY).hora)).toEqual(['01:00', '03:00']);
  });

  it('dentroDoHorario: 09:00–10:00 de terça cabe na regra; 11:30–12:30 (passa do fim) e o mesmo horário na quarta não (aviso "Fora do seu horário de atendimento")', () => {
    expect(dentroDoHorario({ inicio: em('2026-10-20', '09:00'), fim: em('2026-10-20', '10:00') }, [TERCA], SP)).toBe(true);
    expect(dentroDoHorario({ inicio: em('2026-10-20', '11:30'), fim: em('2026-10-20', '12:30') }, [TERCA], SP)).toBe(false);
    expect(dentroDoHorario({ inicio: em('2026-10-21', '09:00'), fim: em('2026-10-21', '10:00') }, [TERCA], SP)).toBe(false);
  });
});

describe('ajudantes dos horários', () => {
  it('sobrepoe: intervalos semiabertos, encostar não é sobrepor (como o EXCLUDE do banco)', () => {
    const das = (a: string, b: string) => ({ inicio: em('2026-10-20', a), fim: em('2026-10-20', b) });
    expect(sobrepoe(das('09:00', '10:00'), das('10:00', '11:00'))).toBe(false);
    expect(sobrepoe(das('10:00', '11:00'), das('09:00', '10:00'))).toBe(false);
    expect(sobrepoe(das('09:00', '10:00'), das('09:59', '11:00'))).toBe(true);
    expect(sobrepoe(das('09:00', '12:00'), das('10:00', '11:00'))).toBe(true);
  });

  it('minutosDe: "HH:MM" em minutos desde 00:00', () => {
    expect([minutosDe('00:00'), minutosDe('08:30'), minutosDe('23:59')]).toEqual([0, 510, 1439]);
  });

  it('HORA_HHMM só aceita HH:MM de 00:00 a 23:59; textoAparado só devolve texto aparado (o resto vira "")', () => {
    expect(['00:00', '08:05', '19:59', '23:59'].every((h) => HORA_HHMM.test(h))).toBe(true);
    expect(['24:00', '8:00', '08:60', '08:0', '08:00:00', ' 08:00', '', 'ab:cd'].some((h) => HORA_HHMM.test(h))).toBe(false);
    expect(textoAparado('  Congresso  ')).toBe('Congresso');
    expect([textoAparado(undefined), textoAparado(null), textoAparado(42), textoAparado(new File([], 'x'))]).toEqual(['', '', '', '']);
  });
  it('horariosVisiveis: ISO, dia curto e hora no fuso, na ordem', () => {
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, online: false });
    expect(horariosVisiveis(hs.slice(0, 2), SP)).toEqual([
      { inicio: '2026-10-20T11:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '08:00', modalidades: ['presencial'] },
      { inicio: '2026-10-20T12:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '09:00', modalidades: ['presencial'] },
    ]);
  });
});
