import { describe, expect, it } from 'vitest';
import { rotuloDaAntecedencia, rotuloDoDiario, rotuloDoDiarioNoPortal, rotuloDoIntervalo, rotuloDosDias, rotuloDosHorarios, TEXTOS_PUSH, TITULO_PUSH } from './constantes';

describe('formatadores dos lembretes (painel e portal)', () => {
  it('rotuloDoIntervalo', () => {
    expect(rotuloDoIntervalo(60)).toBe('1 h');
    expect(rotuloDoIntervalo(90)).toBe('1h30');
    expect(rotuloDoIntervalo(120)).toBe('2 h');
    expect(rotuloDoIntervalo(180)).toBe('3 h');
    expect(rotuloDoIntervalo(240)).toBe('4 h');
  });

  it('rotuloDosDias', () => {
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5, 6])).toBe('todos os dias');
    expect(rotuloDosDias([6, 5, 4, 3, 2, 1, 0])).toBe('todos os dias');
    expect(rotuloDosDias([1, 2, 3, 4, 5])).toBe('seg a sex');
    expect(rotuloDosDias([0, 6])).toBe('sáb e dom');
    expect(rotuloDosDias([5, 1, 3])).toBe('seg, qua e sex');
    expect(rotuloDosDias([0, 1, 2, 3, 4, 5])).toBe('seg, ter, qua, qui, sex e dom');
    expect(rotuloDosDias([1, 2, 3, 4, 5, 6])).toBe('seg, ter, qua, qui, sex e sáb');
    expect(rotuloDosDias([3])).toBe('qua');
  });

  it('rotuloDosHorarios (portal, Tarefa 6): em ordem, "a, b e c"', () => {
    expect(rotuloDosHorarios(['08:00'])).toBe('08:00');
    expect(rotuloDosHorarios(['20:00', '08:00'])).toBe('08:00 e 20:00');
    expect(rotuloDosHorarios(['12:00', '08:00', '20:00', '16:00'])).toBe('08:00, 12:00, 16:00 e 20:00');
  });

  it('rotuloDaAntecedencia', () => {
    expect(rotuloDaAntecedencia(0)).toBe('na hora');
    expect(rotuloDaAntecedencia(15)).toBe('15 min antes');
    expect(rotuloDaAntecedencia(30)).toBe('30 min antes');
  });

  it('rotuloDoDiario', () => {
    expect(rotuloDoDiario(null)).toBe('sem pedido de registro');
    expect(rotuloDoDiario(30)).toBe('pedir registro no diário 30 min depois');
    expect(rotuloDoDiario(60)).toBe('pedir registro no diário 60 min depois');
  });

  it('rotuloDoDiarioNoPortal', () => {
    expect(rotuloDoDiarioNoPortal(null)).toBeNull();
    expect(rotuloDoDiarioNoPortal(30)).toBe('pedido de registro no diário 30 min depois');
    expect(rotuloDoDiarioNoPortal(60)).toBe('pedido de registro no diário 60 min depois');
  });
});

describe('textos do push (Global Constraints: exatos, tela de bloqueio)', () => {
  it('título e corpos fixos; a refeição só com o rótulo da lista fechada', () => {
    expect(TITULO_PUSH).toBe('NutriDebby');
    expect(TEXTOS_PUSH.agua).toBe('Hora de beber água 💧');
    expect(TEXTOS_PUSH.refeicaoAntes('Almoço')).toBe('Está chegando a hora: Almoço');
    expect(TEXTOS_PUSH.refeicaoNaHora('Almoço')).toBe('Hora de: Almoço');
    expect(TEXTOS_PUSH.refeicaoAntesGenerica).toBe('Está chegando a hora da sua refeição');
    expect(TEXTOS_PUSH.refeicaoNaHoraGenerica).toBe('Hora da sua refeição');
    expect(TEXTOS_PUSH.diario).toBe('Registre sua refeição no diário');
    expect(TEXTOS_PUSH.suplemento).toBe('Hora do seu suplemento');
    expect(TEXTOS_PUSH.livre).toBe('Você tem um lembrete do seu plano');
  });
});
