import { describe, expect, it } from 'vitest';
import { sugestaoInicial, validarConfig, validarLembrete } from './config';

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const agua = (config: Record<string, unknown>) => ({ tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: TODOS, ...config } });
const suplemento = (config: Record<string, unknown>, texto: unknown = 'Vitamina D') => ({ tipo: 'suplemento', config: { horarios: ['08:00'], dias: [1, 2, 3, 4, 5], ...config }, texto });

const erros = (r: ReturnType<typeof validarLembrete>) => (r.ok ? null : r.erros);

describe('validarLembrete', () => {
  it('aceita a sugestão inicial (água 08:00–20:00 a cada 2 h todos os dias; refeições na hora, sem diário)', () => {
    const s = sugestaoInicial();
    expect(s).toEqual([
      { tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: TODOS } },
      { tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null } },
    ]);
    for (const l of s) expect(validarLembrete(l)).toEqual({ ok: true, valor: l });
  });

  it('recusa início antes de 06:00 e fim depois de 22:00', () => {
    expect(erros(validarLembrete(agua({ inicio: '05:30' })))).toEqual({ inicio: 'Escolha um horário entre 06:00 e 22:00.' });
    expect(erros(validarLembrete(agua({ fim: '22:01' })))).toEqual({ fim: 'Escolha um horário entre 06:00 e 22:00.' });
    expect(validarLembrete(agua({ inicio: '06:00', fim: '22:00' })).ok).toBe(true);
  });

  it('recusa fim antes do início', () => {
    expect(erros(validarLembrete(agua({ inicio: '20:00', fim: '08:00' })))).toEqual({ fim: 'O fim precisa ser depois do início.' });
  });

  it('recusa intervalo fora da lista', () => {
    expect(erros(validarLembrete(agua({ intervaloMin: 45 })))).toEqual({ intervaloMin: 'Escolha um intervalo da lista.' });
  });

  it('recusa dias vazio', () => {
    expect(erros(validarLembrete(agua({ dias: [] })))).toEqual({ dias: 'Escolha ao menos um dia da semana.' });
    expect(erros(validarLembrete(suplemento({ dias: [] })))).toEqual({ dias: 'Escolha ao menos um dia da semana.' });
  });

  it('recusa 5 horários e nenhum horário', () => {
    expect(erros(validarLembrete(suplemento({ horarios: ['08:00', '10:00', '12:00', '14:00', '16:00'] })))).toHaveProperty('horarios');
    expect(erros(validarLembrete(suplemento({ horarios: [] })))).toHaveProperty('horarios');
    expect(validarLembrete(suplemento({ horarios: ['08:00', '10:00', '12:00', '14:00'] })).ok).toBe(true);
  });

  it('recusa dois horários iguais e horário fora da janela', () => {
    expect(erros(validarLembrete(suplemento({ horarios: ['08:00', '08:00'] })))).toEqual({ horarios: 'Há dois horários iguais. Remova um deles.' });
    expect(erros(validarLembrete(suplemento({ horarios: ['08:00', '23:00'] })))).toEqual({ horarios: 'Escolha um horário entre 06:00 e 22:00.' });
  });

  it('texto: vazio e longo, com as mensagens de cada tipo', () => {
    expect(erros(validarLembrete(suplemento({}, 'x'.repeat(61))))).toEqual({ texto: 'Use até 60 caracteres.' });
    expect(validarLembrete(suplemento({}, 'x'.repeat(60))).ok).toBe(true);
    expect(erros(validarLembrete(suplemento({}, '   ')))).toEqual({ texto: 'Escreva o nome do suplemento.' });
    const livre = (texto: unknown) => ({ tipo: 'livre', config: { horarios: ['09:00'], dias: TODOS }, texto });
    expect(erros(validarLembrete(livre('')))).toEqual({ texto: 'Escreva o texto do lembrete.' });
    expect(erros(validarLembrete(livre('y'.repeat(121))))).toEqual({ texto: 'Use até 120 caracteres.' });
    expect(validarLembrete(livre('  Tomar sol  '))).toEqual({ ok: true, valor: { tipo: 'livre', config: { horarios: ['09:00'], dias: TODOS }, texto: 'Tomar sol' } });
  });

  it('SUS-110: o NUL (U+0000) e o surrogate sem par saem em silêncio, antes de aparar e medir; o emoji fica', () => {
    const livre = (texto: unknown) => ({ tipo: 'livre', config: { horarios: ['09:00'], dias: TODOS }, texto });
    for (const c of ['\u0000', '\ud800', '\udc00']) {
      expect(validarLembrete(suplemento({}, `Vitamina${c} D 🙂`))).toMatchObject({ ok: true, valor: { texto: 'Vitamina D 🙂' } });
      expect(validarLembrete(livre(`${c} Tomar sol${c} `))).toMatchObject({ ok: true, valor: { texto: 'Tomar sol' } });
      expect(erros(validarLembrete(livre(` ${c} `)))).toEqual({ texto: 'Escreva o texto do lembrete.' });
    }
    // conta depois da limpeza: 60 caracteres + NUL cabem no suplemento
    expect(validarLembrete(suplemento({}, `${'x'.repeat(60)}\u0000`)).ok).toBe(true);
  });

  it('refeições: antecedência e diário só da lista', () => {
    expect(validarLembrete({ tipo: 'refeicoes', config: { antecedenciaMin: 30, diarioDepoisMin: 60 } }).ok).toBe(true);
    expect(erros(validarLembrete({ tipo: 'refeicoes', config: { antecedenciaMin: 10, diarioDepoisMin: 45 } }))).toEqual({
      antecedenciaMin: expect.any(String),
      diarioDepoisMin: expect.any(String),
    });
  });

  it('não guarda chaves estranhas nem texto na água', () => {
    expect(validarLembrete({ ...agua({ extra: 1 }), texto: 'nada' })).toEqual({ ok: true, valor: agua({}) });
  });

  it('recusa tipo desconhecido e entrada que não é objeto', () => {
    expect(validarLembrete({ tipo: 'pesagem', config: {} }).ok).toBe(false);
    expect(validarLembrete(null).ok).toBe(false);
    expect(validarLembrete({ tipo: 'agua' }).ok).toBe(false);
  });
});

describe('validarConfig (worker: sem o texto)', () => {
  it('aceita suplemento sem texto', () => {
    expect(validarConfig('suplemento', { horarios: ['08:00'], dias: [1] })).toEqual({ ok: true, valor: { tipo: 'suplemento', config: { horarios: ['08:00'], dias: [1] } } });
  });

  it('recusa config malformada', () => {
    expect(validarConfig('agua', { inicio: '8h', fim: '20:00', intervaloMin: 120, dias: TODOS })).toEqual({ ok: false });
    expect(validarConfig('agua', null)).toEqual({ ok: false });
    expect(validarConfig('refeicoes', { antecedenciaMin: 0 })).toEqual({ ok: false });
    expect(validarConfig('livre', { horarios: '08:00', dias: [1] })).toEqual({ ok: false });
    expect(validarConfig('suplemento', { horarios: ['08:00'], dias: [7] })).toEqual({ ok: false });
  });
});
