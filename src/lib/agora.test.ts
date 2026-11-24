import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agora, lerE2eAgora } from './agora';

const REAL = Date.parse('2026-11-24T15:00:00Z');
const MIN = 60_000;

describe('SUS-119 — agora() e E2E_AGORA', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: REAL, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('sem a variável (ou vazia), é o relógio real', () => {
    vi.stubEnv('E2E_AGORA', undefined);
    expect(agora().getTime()).toBe(REAL);
    vi.advanceTimersByTime(5 * MIN);
    expect(agora().getTime()).toBe(REAL + 5 * MIN);
    vi.stubEnv('E2E_AGORA', '');
    expect(agora().getTime()).toBe(REAL + 5 * MIN);
  });

  it('instante ISO com fuso: começa nesse instante no primeiro uso e segue andando', () => {
    vi.stubEnv('E2E_AGORA', '2026-12-01T08:00:00-03:00');
    const inicio = Date.parse('2026-12-01T11:00:00Z');
    vi.advanceTimersByTime(2 * MIN); // o boot não conta: o deslocamento é medido no primeiro uso
    expect(agora().getTime()).toBe(inicio);
    vi.advanceTimersByTime(90 * MIN);
    expect(agora().getTime()).toBe(inicio + 90 * MIN);
    expect(agora().toISOString()).toBe('2026-12-01T12:30:00.000Z');
  });

  it('deslocamento relativo: soma ao relógio real (minutos, horas e dias, para frente e para trás)', () => {
    vi.stubEnv('E2E_AGORA', '+36h');
    expect(agora().getTime()).toBe(REAL + 36 * 60 * MIN);
    vi.advanceTimersByTime(10 * MIN);
    expect(agora().getTime()).toBe(REAL + 10 * MIN + 36 * 60 * MIN);
    vi.stubEnv('E2E_AGORA', '-2d');
    expect(agora().getTime()).toBe(REAL + 10 * MIN - 2 * 24 * 60 * MIN);
    vi.stubEnv('E2E_AGORA', '+90m');
    expect(agora().getTime()).toBe(REAL + 10 * MIN + 90 * MIN);
  });

  it('valor inválido: erro claro, que não aceita o relógio real em silêncio', () => {
    for (const v of ['amanhã', '36h', '+36s', '+1.5h', '2026-12-01T08:00:00', '2026-12-01', '2026-02-30T08:00:00-03:00', '2026-12-01T24:00:00Z', ' +1d']) {
      vi.stubEnv('E2E_AGORA', v);
      expect(() => agora(), v).toThrow(/Configuração inválida — E2E_AGORA: E2E_AGORA deve ser um instante ISO 8601 com fuso/);
    }
  });

  it('lerE2eAgora: os formatos aceitos', () => {
    expect(lerE2eAgora('+90m')).toEqual({ tipo: 'deslocamento', ms: 90 * MIN });
    expect(lerE2eAgora('-2d')).toEqual({ tipo: 'deslocamento', ms: -2 * 24 * 60 * MIN });
    expect(lerE2eAgora('+0h')).toEqual({ tipo: 'deslocamento', ms: 0 });
    expect(lerE2eAgora('2026-12-01T08:00:00-03:00')).toEqual({ tipo: 'instante', em: Date.parse('2026-12-01T11:00:00Z') });
    expect(lerE2eAgora('2026-12-01T08:00Z')).toEqual({ tipo: 'instante', em: Date.parse('2026-12-01T08:00:00Z') });
    expect(lerE2eAgora('2028-02-29T23:59:59.500+00:00')).toEqual({ tipo: 'instante', em: Date.parse('2028-02-29T23:59:59.500Z') });
    expect(lerE2eAgora('2027-02-29T08:00:00Z')).toBeNull(); // 2027 não é bissexto
  });
});
