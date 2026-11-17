import { describe, expect, it } from 'vitest';
import { partesNoFuso } from '@/modules/agenda/fuso';
import type { ConfigAgua, ConfigHorarios, ConfigRefeicoes } from './config';
import { maiorDiaDaSemana, planoDoDia, type LembreteParaSlots, type RefeicaoDoPlano } from './slots';

const SP = 'America/Sao_Paulo';
const SEGUNDA = '2026-11-16';
const SABADO = '2026-11-21';
const TODOS: ConfigAgua['dias'] = [0, 1, 2, 3, 4, 5, 6];

const agua = (c: Partial<ConfigAgua> = {}, id = 'agua'): LembreteParaSlots => ({
  id,
  ativo: true,
  tipo: 'agua',
  config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: TODOS, ...c },
});
const refeicoes = (c: Partial<ConfigRefeicoes> = {}, id = 'ref'): LembreteParaSlots => ({
  id,
  ativo: true,
  tipo: 'refeicoes',
  config: { antecedenciaMin: 0, diarioDepoisMin: null, ...c },
});
const horarios = (tipo: 'suplemento' | 'livre', c: Partial<ConfigHorarios>, id: string): LembreteParaSlots => ({ id, ativo: true, tipo, config: { horarios: ['08:00'], dias: TODOS, ...c } });

const plano = (lembretes: LembreteParaSlots[], refs: RefeicaoDoPlano[] = [], extra: { data?: string; fuso?: string; refeicoesNoDiario?: string[] } = {}) =>
  planoDoDia({ lembretes, refeicoes: refs, data: extra.data ?? SEGUNDA, fuso: extra.fuso ?? SP, refeicoesNoDiario: extra.refeicoesNoDiario });
const horas = (r: ReturnType<typeof planoDoDia>, fuso = SP) => r.slots.map((s) => `${partesNoFuso(s.em, fuso).hora} ${s.tipo}`);

describe('planoDoDia', () => {
  it('água 08–20 a cada 2h dá 7 slots', () => {
    const r = plano([agua()]);
    expect(horas(r)).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((h) => `${h} agua`));
    expect(r.slots.every((s) => s.lembreteIds.length === 1 && s.lembreteIds[0] === 'agua' && s.refeicao === null)).toBe(true);
    expect(r.cortados).toEqual({ total: 0, tipos: [] });
  });

  it('água a cada 1h30 de 06:00 a 22:00: o slot das 22:00 vale', () => {
    expect(horas(plano([agua({ inicio: '06:00', fim: '22:00', intervaloMin: 90 })])).at(-1)).toBe('21:00 agua');
    expect(horas(plano([agua({ inicio: '06:00', fim: '22:00', intervaloMin: 60 })])).at(-1)).toBe('22:00 agua');
  });

  it('refeição 30 min antes e diário 60 min depois', () => {
    const r = plano([refeicoes({ antecedenciaMin: 30, diarioDepoisMin: 60 })], [{ nome: 'Almoço', horario: '12:00' }]);
    expect(horas(r)).toEqual(['11:30 refeicao', '13:00 diario']);
    expect(r.slots.map((s) => s.refeicao)).toEqual(['Almoço', 'Almoço']);
    expect(r.slots.map((s) => s.lembreteIds)).toEqual([['ref'], ['ref']]);
  });

  it('refeição sem horário não gera slot; Ceia 22:30 fica fora da janela', () => {
    const r = plano([refeicoes({ diarioDepoisMin: 30 })], [
      { nome: 'Café da manhã', horario: '07:00' },
      { nome: 'Lanche', horario: null },
      { nome: 'Ceia', horario: '22:30' },
    ]);
    expect(horas(r)).toEqual(['07:00 refeicao', '07:30 diario']);
    expect(r.refeicoesSemHorario).toEqual(['Lanche']);
    expect(r.refeicoesForaDaJanela).toEqual(['Ceia']);
  });

  it('horário vindo do banco (coluna time, HH:MM:SS) gera o slot da refeição', () => {
    const r = plano([refeicoes()], [{ nome: 'Almoço', horario: '12:00:00' }]);
    expect(horas(r)).toEqual(['12:00 refeicao']);
    expect(r.slots[0].refeicao).toBe('Almoço');
    expect(r.refeicoesSemHorario).toEqual([]);
  });

  it('sem lembrete de refeições ativo, nada de refeição nem avisos de refeição', () => {
    const r = plano([{ ...refeicoes(), ativo: false }, agua({ inicio: '08:00', fim: '08:00' })], [{ nome: 'Lanche', horario: null }, { nome: 'Almoço', horario: '12:00' }]);
    expect(horas(r)).toEqual(['08:00 agua']);
    expect(r.refeicoesSemHorario).toEqual([]);
    expect(r.refeicoesForaDaJanela).toEqual([]);
  });

  it('mesmo minuto vira um push', () => {
    const r = plano([agua(), refeicoes()], [{ nome: 'Almoço', horario: '12:00' }]);
    const meioDia = r.slots.filter((s) => partesNoFuso(s.em, SP).hora === '12:00');
    expect(meioDia).toEqual([{ em: new Date('2026-11-16T15:00:00Z'), tipo: 'refeicao', lembreteIds: ['ref', 'agua'], refeicao: 'Almoço' }]);
    expect(r.slots).toHaveLength(7);
  });

  it('fusão: prioridade refeição > suplemento > livre > diário > água; duas refeições no mesmo minuto ficam com a primeira do plano', () => {
    const r = plano(
      [agua({ inicio: '13:00', fim: '13:00' }), horarios('livre', { horarios: ['13:00', '09:00'] }, 'livre'), refeicoes({ diarioDepoisMin: 60 }), horarios('suplemento', { horarios: ['09:00'] }, 'sup')],
      [
        { nome: 'Lanche da manhã', horario: '09:00' },
        { nome: 'Lanche', horario: '09:00' },
        { nome: 'Almoço', horario: '12:00' },
      ],
    );
    expect(r.slots.map((s) => [partesNoFuso(s.em, SP).hora, s.tipo, s.refeicao, [...s.lembreteIds].sort()])).toEqual([
      ['09:00', 'refeicao', 'Lanche da manhã', ['livre', 'ref', 'sup']],
      ['10:00', 'diario', 'Lanche da manhã', ['ref']],
      ['12:00', 'refeicao', 'Almoço', ['ref']],
      ['13:00', 'livre', null, ['agua', 'livre', 'ref']],
    ]);
  });

  it('teto 24 corta água primeiro', () => {
    const refs = ['07:30', '10:30', '12:30', '15:30', '18:30', '20:30'].map((horario, i) => ({ nome: `Refeição ${i + 1}`, horario }));
    const r = plano([agua({ inicio: '06:00', fim: '22:00', intervaloMin: 60 }), refeicoes({ antecedenciaMin: 0, diarioDepoisMin: 60 })], refs);
    expect(r.slots).toHaveLength(24);
    expect(r.cortados).toEqual({ total: 5, tipos: ['agua'] });
    expect(r.slots.filter((s) => s.tipo === 'refeicao')).toHaveLength(6);
    expect(r.slots.filter((s) => s.tipo === 'diario')).toHaveLength(6);
    expect(r.slots.filter((s) => s.tipo === 'agua')).toHaveLength(12);
    // corte determinístico: saem as águas mais tarde do dia
    expect(horas(r).filter((h) => h.endsWith('agua')).at(-1)).toBe('17:00 agua');
    expect(r.slots.map((s) => s.em.getTime())).toEqual([...r.slots.map((s) => s.em.getTime())].sort((a, b) => a - b));
  });

  it('teto 24: sem água, corta o diário antes do livre', () => {
    const refs = ['07:30', '10:30', '12:30', '15:30', '18:30', '20:30'].map((horario, i) => ({ nome: `R${i}`, horario }));
    const livres = ['06:00', '07:00', '08:00', '09:00'].map((h, i) => horarios('livre', { horarios: [h, `1${i + 1}:00`, `1${i + 5}:00`, `${i + 6 < 10 ? '0' : ''}${i + 6}:15`] }, `l${i}`));
    const sups = [horarios('suplemento', { horarios: ['19:00', '20:00', '21:00', '22:00'] }, 's0')];
    const r = plano([...livres, ...sups, refeicoes({ diarioDepoisMin: 60 })], refs);
    // 16 livres + 4 suplementos + 6 refeições + 6 diários = 32
    expect(r.slots).toHaveLength(24);
    expect(r.cortados).toEqual({ total: 8, tipos: ['diario', 'livre'] });
    expect(r.slots.filter((s) => s.tipo === 'diario')).toHaveLength(0);
    expect(r.slots.filter((s) => s.tipo === 'refeicao')).toHaveLength(6);
    expect(r.slots.filter((s) => s.tipo === 'suplemento')).toHaveLength(4);
  });

  it('diário registrado não derruba a água do mesmo minuto', () => {
    const r = plano([refeicoes({ diarioDepoisMin: 60 }), agua({ inicio: '13:00', fim: '13:00' })], [{ nome: 'Almoço', horario: '12:00' }], { refeicoesNoDiario: ['Almoço'] });
    expect(horas(r)).toEqual(['12:00 refeicao', '13:00 agua']);
    expect(r.slots[1].lembreteIds).toEqual(['agua']);
    expect(r.slots[1].refeicao).toBeNull();
  });

  it('validoDesde: descarta os slots do lembrete antes dele (e só os dele)', () => {
    const r = plano([{ ...agua(), validoDesde: new Date('2026-11-16T13:03:00Z') }, horarios('suplemento', { horarios: ['08:00'] }, 'sup')]);
    expect(horas(r)).toEqual(['08:00 suplemento', '12:00 agua', '14:00 agua', '16:00 agua', '18:00 agua', '20:00 agua']);
  });

  it('fuso: America/Manaus, água 08:00 em 2026-11-16 → 12:00Z (e Noronha → 10:00Z)', () => {
    expect(plano([agua()], [], { fuso: 'America/Manaus' }).slots[0].em).toEqual(new Date('2026-11-16T12:00:00Z'));
    expect(plano([agua()], [], { fuso: 'America/Noronha' }).slots[0].em).toEqual(new Date('2026-11-16T10:00:00Z'));
    // o último slot (20:00 em Manaus) cai no dia seguinte em UTC e continua sendo do dia 16
    expect(plano([agua()], [], { fuso: 'America/Manaus' }).slots.at(-1)!.em).toEqual(new Date('2026-11-17T00:00:00Z'));
  });

  it('dia da semana: suplemento só seg–sex não gera slot num sábado', () => {
    const sup = horarios('suplemento', { horarios: ['08:00'], dias: [1, 2, 3, 4, 5] }, 'sup');
    expect(plano([sup], [], { data: SABADO }).slots).toEqual([]);
    expect(plano([sup], [], { data: SEGUNDA }).slots).toHaveLength(1);
  });

  it('lembrete com texto (LembreteNovo) continua atribuível e o texto não vai ao slot', () => {
    const comTexto = { id: 'l', ativo: true, tipo: 'livre' as const, config: { horarios: ['09:00'], dias: TODOS }, texto: 'Tomar sol' };
    const r = plano([comTexto]);
    expect(JSON.stringify(r)).not.toContain('Tomar sol');
  });
});

describe('maiorDiaDaSemana', () => {
  it('maior total entre os 7 dias, antes do teto', () => {
    const l = [agua({ dias: [1, 2, 3, 4, 5] }), horarios('livre', { horarios: ['07:00', '09:00'], dias: [6] }, 'livre')];
    expect(maiorDiaDaSemana({ lembretes: l, refeicoes: [], fuso: SP })).toBe(7);
    const muitos = [agua({ inicio: '06:00', fim: '22:00', intervaloMin: 60 }), refeicoes({ diarioDepoisMin: 60 })];
    const refs = ['07:30', '10:30', '12:30', '15:30', '18:30', '20:30'].map((horario, i) => ({ nome: `R${i}`, horario }));
    expect(maiorDiaDaSemana({ lembretes: muitos, refeicoes: refs, fuso: SP })).toBe(29);
  });

  it('ignora validoDesde e refeicoesNoDiario (é previsão, não o envio de hoje)', () => {
    const l = [{ ...agua(), validoDesde: new Date('2100-01-01T00:00:00Z') }, refeicoes({ diarioDepoisMin: 30 })];
    expect(maiorDiaDaSemana({ lembretes: l, refeicoes: [{ nome: 'Almoço', horario: '12:15' }], fuso: SP, refeicoesNoDiario: ['Almoço'] })).toBe(9);
  });
});
