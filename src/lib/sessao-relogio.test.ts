import { describe, expect, it } from 'vitest';
import { lerEstado, lerMensagem, motivoLocal, proximoPasso, relogioDe } from './sessao-relogio';

const MIN = 60_000;
const H = 60 * MIN;
const T = 1_000_000;
const estado = { inatividadeMs: 30 * MIN, limiteMs: 6 * H, avisoMs: 2 * MIN, cadenciaMs: 5 * MIN };

describe('relógio da tela da equipe (P12-14)', () => {
  it('relogioDe usa ms relativos do servidor com o relógio do aparelho', () => {
    expect(relogioDe(estado, T)).toEqual({ prazo: T + 30 * MIN, limite: T + 6 * H, avisoMs: 2 * MIN, cadenciaMs: 5 * MIN });
  });

  it('espera até 2 min antes do fim, avisa até o fim e então encerra por inatividade', () => {
    const r = relogioDe(estado, T);
    expect(proximoPasso(r, T)).toEqual({ tipo: 'esperar', ate: T + 28 * MIN });
    expect(proximoPasso(r, T + 28 * MIN - 1)).toEqual({ tipo: 'esperar', ate: T + 28 * MIN });
    expect(proximoPasso(r, T + 28 * MIN)).toEqual({ tipo: 'avisar', ate: T + 30 * MIN });
    expect(proximoPasso(r, T + 30 * MIN)).toEqual({ tipo: 'encerrar', motivo: 'inatividade' });
  });

  it('perto das 8 h, o limite vem antes: sem aviso de inatividade (não se renova) e encerra com o motivo "limite"', () => {
    const r = relogioDe({ ...estado, limiteMs: 10 * MIN }, T);
    expect(proximoPasso(r, T)).toEqual({ tipo: 'esperar', ate: T + 10 * MIN });
    expect(proximoPasso(r, T + 9 * MIN)).toEqual({ tipo: 'esperar', ate: T + 10 * MIN });
    expect(proximoPasso(r, T + 10 * MIN)).toEqual({ tipo: 'encerrar', motivo: 'limite' });
  });

  it('motivoLocal: o limite quando a hora dele chegou; senão inatividade (também sem relógio)', () => {
    const r = relogioDe({ ...estado, limiteMs: 10 * MIN }, T);
    expect(motivoLocal(r, T + 10 * MIN)).toBe('limite');
    expect(motivoLocal(r, T + 5 * MIN)).toBe('inatividade');
    expect(motivoLocal(null, T)).toBe('inatividade');
  });

  it('lerEstado aceita só os quatro números não negativos', () => {
    expect(lerEstado(estado)).toEqual(estado);
    expect(lerEstado({ ...estado, extra: 'x' })).toEqual(estado);
    for (const ruim of [null, 'x', {}, { ...estado, avisoMs: -1 }, { ...estado, limiteMs: '1' }, { ...estado, inatividadeMs: Number.NaN }]) {
      expect(lerEstado(ruim)).toBeNull();
    }
  });

  it('lerMensagem: só "renovada" com horários e "encerrar" com motivo da lista (nada de dado pessoal passa)', () => {
    expect(lerMensagem({ tipo: 'renovada', prazo: 1, limite: 2, ping: 3, nome: 'Ana' })).toEqual({ tipo: 'renovada', prazo: 1, limite: 2, ping: 3 });
    expect(lerMensagem({ tipo: 'encerrar', motivo: 'limite' })).toEqual({ tipo: 'encerrar', motivo: 'limite' });
    for (const ruim of [null, { tipo: 'encerrar', motivo: 'https://evil' }, { tipo: 'renovada', prazo: '1', limite: 2, ping: 3 }, { tipo: 'outra' }]) {
      expect(lerMensagem(ruim)).toBeNull();
    }
  });
});
