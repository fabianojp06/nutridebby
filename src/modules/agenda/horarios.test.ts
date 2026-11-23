import { describe, expect, it } from 'vitest';
import { paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, HORA_HHMM, horariosVisiveis, type LocalDaGeracao, minutosDe, type Regra, regraNoLocal, sobrepoe, textoAparado } from './horarios';

const SP = 'America/Sao_Paulo';
const em = (data: string, hora: string) => paraInstante(data, hora, SP)!;
const rotulos = (hs: { inicio: Date }[]) => hs.map((h) => { const p = partesNoFuso(h.inicio, SP); return `${p.data} ${p.hora}`; });
const TERCA: Regra = { diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'presencial', localId: null };
const semana = { de: em('2026-10-19', '00:00'), ate: em('2026-10-26', '00:00'), fuso: SP };
// Plano 23: o consultório tem pelo menos o "Consultório" (presencial, principal); a ordem da lista é a da projeção (principal, created_at)
const CONSULTORIO: LocalDaGeracao = { id: 'c0000000-0000-4000-8000-000000000001', tipo: 'presencial', principal: true, agendamentoOnline: true };
const CLINICA: LocalDaGeracao = { id: 'c0000000-0000-4000-8000-000000000002', tipo: 'presencial', principal: false, agendamentoOnline: true };
const VIDEO: LocalDaGeracao = { id: 'c0000000-0000-4000-8000-000000000003', tipo: 'online', principal: false, agendamentoOnline: true };
const VIDEO_2: LocalDaGeracao = { id: 'c0000000-0000-4000-8000-000000000004', tipo: 'online', principal: false, agendamentoOnline: true };
const SO_CONSULTORIO = { locais: [CONSULTORIO], soAgendamentoOnline: false };

describe('gerarHorarios (RN-03, US-030)', () => {
  it('"terça, 08:00–12:00, 60 min, presencial" → 08:00, 09:00, 10:00 e 11:00', () => {
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, ...SO_CONSULTORIO });
    expect(rotulos(hs)).toEqual(['2026-10-20 08:00', '2026-10-20 09:00', '2026-10-20 10:00', '2026-10-20 11:00']);
    expect(hs[0].modalidades).toEqual(['presencial']);
    expect(hs[0].fim.getTime() - hs[0].inicio.getTime()).toBe(60 * 60_000);
  });

  it('bloqueio de 20/10 a 24/10 ("Congresso") tira todos os horários desses dias', () => {
    const bloqueio = { inicio: em('2026-10-20', '00:00'), fim: em('2026-10-25', '00:00') };
    expect(gerarHorarios({ regras: [TERCA], bloqueios: [bloqueio], ocupados: [], ...semana, ...SO_CONSULTORIO })).toEqual([]);
  });

  it('consulta não cancelada ocupa o horário, inclusive em parte (09:30–10:30 tira 09:00 e 10:00)', () => {
    const ocupado = { inicio: em('2026-10-20', '09:30'), fim: em('2026-10-20', '10:30') };
    expect(rotulos(gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [ocupado], ...semana, ...SO_CONSULTORIO }))).toEqual(['2026-10-20 08:00', '2026-10-20 11:00']);
  });

  it('US-032: às 10:00 de 14/10, com antecedência de 12 h, o primeiro horário é 22:00 de 14/10; nada depois de 60 dias', () => {
    const quarta: Regra = { diaSemana: 3, inicio: '08:00', fim: '23:00', duracaoMin: 60, modalidade: 'ambas', localId: null };
    const agora = em('2026-10-14', '10:00');
    const hs = gerarHorarios({ regras: [quarta], bloqueios: [], ocupados: [], de: new Date(agora.getTime() + 12 * 3_600_000), ate: new Date(agora.getTime() + 60 * 86_400_000), fuso: SP, ...SO_CONSULTORIO });
    expect(rotulos(hs)[0]).toBe('2026-10-14 22:00');
    expect(partesNoFuso(hs.at(-1)!.inicio, SP).data).toBe('2026-12-09');
    expect(hs[0].modalidades).toEqual(['presencial']); // sem local online ativo, "ambas" só oferece presencial (RN-410a)
  });

  it('Plano 23: regra online sem local e sem local online ativo não oferece nada; com um, oferece nele', () => {
    const online: Regra = { diaSemana: 2, inicio: '08:00', fim: '10:00', duracaoMin: 30, modalidade: 'online', localId: null };
    expect(gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, ...SO_CONSULTORIO })).toEqual([]);
    const hs = gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, locais: [CONSULTORIO, VIDEO], soAgendamentoOnline: false });
    expect(hs.map((h) => [h.modalidades, h.localId])).toEqual(Array(4).fill([['online'], VIDEO.id]));
  });

  it('AG-D47 por local (Plano 23, T3): a junção só vale no mesmo local — "ambas" sem local (RN-410a) e o par desdobrado dão um horário por local', () => {
    // o backfill desdobra "ambas" em uma regra presencial (no presencial principal) e uma online (no primeiro online ativo)
    const presencial: Regra = { ...TERCA, modalidade: 'presencial', localId: CONSULTORIO.id };
    const online: Regra = { ...TERCA, modalidade: 'online', localId: VIDEO.id };
    const desdobrado = gerarHorarios({ regras: [online, presencial], bloqueios: [], ocupados: [], ...semana, locais: [CONSULTORIO, VIDEO], soAgendamentoOnline: false });
    const ambas = gerarHorarios({ regras: [{ ...TERCA, modalidade: 'ambas' }], bloqueios: [], ocupados: [], ...semana, locais: [CONSULTORIO, VIDEO], soAgendamentoOnline: false });
    expect(desdobrado).toEqual(ambas);
    expect(rotulos(desdobrado)).toEqual(['08:00', '09:00', '10:00', '11:00'].flatMap((h) => [`2026-10-20 ${h}`, `2026-10-20 ${h}`]));
    // no mesmo instante, o local presencial vem antes do online (a ordem dos locais)
    expect(desdobrado.slice(0, 2).map((h) => [h.localId, h.modalidades])).toEqual([
      [CONSULTORIO.id, ['presencial']],
      [VIDEO.id, ['online']],
    ]);
    // a regra online de um local que não está entre os ativos (arquivado) não oferece nada
    expect(gerarHorarios({ regras: [online, presencial], bloqueios: [], ocupados: [], ...semana, ...SO_CONSULTORIO }).map((h) => [h.localId, h.modalidades])).toEqual(Array(4).fill([CONSULTORIO.id, ['presencial']]));
    // mesmo início com fim diferente (outra duração) não junta, nem no mesmo local
    const curta: Regra = { ...TERCA, inicio: '13:00', fim: '14:00', duracaoMin: 30, localId: CONSULTORIO.id };
    const longa: Regra = { ...TERCA, inicio: '13:00', fim: '14:00', duracaoMin: 60, localId: CLINICA.id };
    const hs = gerarHorarios({ regras: [curta, longa], bloqueios: [], ocupados: [], ...semana, locais: [CONSULTORIO, CLINICA], soAgendamentoOnline: false });
    expect(hs.map((h) => [rotulos([h])[0], (h.fim.getTime() - h.inicio.getTime()) / 60_000, h.localId])).toEqual([
      ['2026-10-20 13:00', 30, CONSULTORIO.id],
      ['2026-10-20 13:00', 60, CLINICA.id],
      ['2026-10-20 13:30', 30, CONSULTORIO.id],
    ]);
  });

  it('o mesmo início em dois locais dá dois horários (um por localId); duas regras iguais no mesmo local dão um só', () => {
    const naClinica: Regra = { ...TERCA, localId: CLINICA.id };
    const noConsultorio: Regra = { ...TERCA, localId: CONSULTORIO.id };
    const hs = gerarHorarios({ regras: [naClinica, noConsultorio, noConsultorio], bloqueios: [], ocupados: [], ...semana, locais: [CONSULTORIO, CLINICA], soAgendamentoOnline: false });
    expect(hs).toHaveLength(8);
    expect(hs.slice(0, 2).map((h) => [rotulos([h])[0], h.localId])).toEqual([
      ['2026-10-20 08:00', CONSULTORIO.id],
      ['2026-10-20 08:00', CLINICA.id],
    ]);
    // uma consulta em qualquer local ocupa o horário nos dois (RN-408)
    const ocupado = { inicio: em('2026-10-20', '08:00'), fim: em('2026-10-20', '09:00') };
    expect(gerarHorarios({ regras: [naClinica, noConsultorio], bloqueios: [], ocupados: [ocupado], ...semana, locais: [CONSULTORIO, CLINICA], soAgendamentoOnline: false }).some((h) => h.inicio.getTime() === ocupado.inicio.getTime())).toBe(false);
  });

  it('horário de verão: a hora que não existe é pulada', () => {
    const NY = 'America/New_York';
    const domingo: Regra = { diaSemana: 0, inicio: '01:00', fim: '04:00', duracaoMin: 60, modalidade: 'presencial', localId: null };
    const hs = gerarHorarios({ regras: [domingo], bloqueios: [], ocupados: [], de: paraInstante('2026-03-08', '00:00', NY)!, ate: paraInstante('2026-03-09', '00:00', NY)!, fuso: NY, ...SO_CONSULTORIO });
    expect(hs.map((h) => partesNoFuso(h.inicio, NY).hora)).toEqual(['01:00', '03:00']);
  });

  it('dentroDoHorario: 09:00–10:00 de terça cabe na regra; 11:30–12:30 (passa do fim) e o mesmo horário na quarta não (aviso "Fora do seu horário de atendimento")', () => {
    expect(dentroDoHorario({ inicio: em('2026-10-20', '09:00'), fim: em('2026-10-20', '10:00') }, [TERCA], SP)).toBe(true);
    expect(dentroDoHorario({ inicio: em('2026-10-20', '11:30'), fim: em('2026-10-20', '12:30') }, [TERCA], SP)).toBe(false);
    expect(dentroDoHorario({ inicio: em('2026-10-21', '09:00'), fim: em('2026-10-21', '10:00') }, [TERCA], SP)).toBe(false);
  });
});

describe('regraNoLocal e o recorte do agendamento (Plano 23, RN-410a, AG-D62)', () => {
  const fixa = (modalidade: Regra['modalidade'], localId: string | null = null): Regra => ({ ...TERCA, modalidade, localId });

  it('regra com local: o próprio local (ativo), com a modalidade do tipo; local fora da lista (arquivado) → nenhum', () => {
    expect(regraNoLocal(fixa('presencial', CLINICA.id), [CONSULTORIO, CLINICA, VIDEO])).toEqual([{ localId: CLINICA.id, modalidade: 'presencial' }]);
    expect(regraNoLocal(fixa('online', VIDEO_2.id), [CONSULTORIO, VIDEO, VIDEO_2])).toEqual([{ localId: VIDEO_2.id, modalidade: 'online' }]);
    expect(regraNoLocal(fixa('presencial', CLINICA.id), [CONSULTORIO, VIDEO])).toEqual([]);
  });

  it('presencial/online sem local: o principal do tipo ou, sem ele, o primeiro ativo do tipo (a ordem da projeção); sem local do tipo → nenhum', () => {
    expect(regraNoLocal(fixa('presencial'), [CLINICA, CONSULTORIO, VIDEO])).toEqual([{ localId: CONSULTORIO.id, modalidade: 'presencial' }]);
    expect(regraNoLocal(fixa('online'), [CONSULTORIO, VIDEO, VIDEO_2])).toEqual([{ localId: VIDEO.id, modalidade: 'online' }]);
    // o principal é online: a presencial sem local vai para o primeiro presencial
    const videoPrincipal = { ...VIDEO_2, principal: true };
    expect(regraNoLocal(fixa('online'), [videoPrincipal, CLINICA, VIDEO])).toEqual([{ localId: VIDEO_2.id, modalidade: 'online' }]);
    expect(regraNoLocal(fixa('presencial'), [videoPrincipal, CLINICA, VIDEO])).toEqual([{ localId: CLINICA.id, modalidade: 'presencial' }]);
    expect(regraNoLocal(fixa('online'), [CONSULTORIO, CLINICA])).toEqual([]);
    expect(regraNoLocal(fixa('presencial'), [VIDEO])).toEqual([]);
    expect(regraNoLocal(fixa('presencial'), [])).toEqual([]);
  });

  it('"ambas" sem local: o presencial principal e o primeiro online ativo; sem online, só o presencial; sem local nenhum, nada', () => {
    expect(regraNoLocal(fixa('ambas'), [CONSULTORIO, CLINICA, VIDEO, VIDEO_2])).toEqual([
      { localId: CONSULTORIO.id, modalidade: 'presencial' },
      { localId: VIDEO.id, modalidade: 'online' },
    ]);
    expect(regraNoLocal(fixa('ambas'), [CONSULTORIO, CLINICA])).toEqual([{ localId: CONSULTORIO.id, modalidade: 'presencial' }]);
    expect(regraNoLocal(fixa('ambas'), [VIDEO])).toEqual([{ localId: VIDEO.id, modalidade: 'online' }]);
    expect(regraNoLocal(fixa('ambas'), [])).toEqual([]);
    expect(gerarHorarios({ regras: [fixa('ambas')], bloqueios: [], ocupados: [], ...semana, locais: [], soAgendamentoOnline: false })).toEqual([]);
  });

  it('soAgendamentoOnline tira os horários do local sem "Aceita agendamento pelo paciente"; o painel (false) vê todos', () => {
    const videoSemAgendamento = { ...VIDEO, agendamentoOnline: false };
    const regras = [fixa('presencial', CONSULTORIO.id), fixa('online', VIDEO.id)];
    const locais = [CONSULTORIO, videoSemAgendamento];
    const fora = gerarHorarios({ regras, bloqueios: [], ocupados: [], ...semana, locais, soAgendamentoOnline: true });
    expect(new Set(fora.map((h) => h.localId))).toEqual(new Set([CONSULTORIO.id]));
    expect(new Set(gerarHorarios({ regras, bloqueios: [], ocupados: [], ...semana, locais, soAgendamentoOnline: false }).map((h) => h.localId))).toEqual(new Set([CONSULTORIO.id, VIDEO.id]));
  });

  it('AG-D62: principal sem agendamento + outro presencial com agendamento — a regra sem local fica no principal e não gera horário com soAgendamentoOnline', () => {
    const principalSem = { ...CONSULTORIO, agendamentoOnline: false };
    const regras = [fixa('presencial')];
    expect(gerarHorarios({ regras, bloqueios: [], ocupados: [], ...semana, locais: [principalSem, CLINICA], soAgendamentoOnline: true })).toEqual([]);
    // no painel (sem o recorte) ela vale no principal, nunca no outro presencial
    expect(new Set(gerarHorarios({ regras, bloqueios: [], ocupados: [], ...semana, locais: [principalSem, CLINICA], soAgendamentoOnline: false }).map((h) => h.localId))).toEqual(new Set([CONSULTORIO.id]));
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
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, ...SO_CONSULTORIO });
    expect(horariosVisiveis(hs.slice(0, 2), SP)).toEqual([
      { inicio: '2026-10-20T11:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '08:00', modalidades: ['presencial'], localId: CONSULTORIO.id },
      { inicio: '2026-10-20T12:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '09:00', modalidades: ['presencial'], localId: CONSULTORIO.id },
    ]);
  });
});
