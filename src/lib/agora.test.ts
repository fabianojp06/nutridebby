import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agora, deslocamentoAte, lerE2eAgora } from './agora';

const REAL = Date.parse('2026-11-24T15:00:00Z');
const SEG = 1_000;
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe('SUS-119 — agora() e E2E_AGORA (só deslocamento)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: REAL, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sem a variável (ou vazia), é o relógio real', () => {
    vi.stubEnv('E2E_AGORA', undefined);
    expect(agora().getTime()).toBe(REAL);
    vi.advanceTimersByTime(5 * MIN);
    expect(agora().getTime()).toBe(REAL + 5 * MIN);
    vi.stubEnv('E2E_AGORA', '');
    expect(agora().getTime()).toBe(REAL + 5 * MIN);
  });

  it('deslocamento: soma ao relógio real e anda (segundos, minutos, horas e dias, para frente e para trás)', () => {
    vi.stubEnv('E2E_AGORA', '+36h');
    expect(agora().getTime()).toBe(REAL + 36 * HORA);
    vi.advanceTimersByTime(10 * MIN);
    expect(agora().getTime()).toBe(REAL + 10 * MIN + 36 * HORA);
    vi.stubEnv('E2E_AGORA', '-2d');
    expect(agora().getTime()).toBe(REAL + 10 * MIN - 2 * DIA);
    vi.stubEnv('E2E_AGORA', '+90m');
    expect(agora().getTime()).toBe(REAL + 10 * MIN + 90 * MIN);
    vi.stubEnv('E2E_AGORA', '+45s');
    expect(agora().getTime()).toBe(REAL + 10 * MIN + 45 * SEG);
    vi.stubEnv('E2E_AGORA', '-604800s');
    expect(agora().getTime()).toBe(REAL + 10 * MIN - 7 * DIA);
  });

  it('o mesmo valor dá o mesmo relógio em processos que leem em instantes reais diferentes (sem cache do primeiro uso)', () => {
    // O lançador calcula UMA vez e passa o mesmo valor ao app e ao worker
    const valor = deslocamentoAte('2026-12-01T08:00:00-03:00', REAL);
    vi.stubEnv('E2E_AGORA', valor);
    const alvo = Date.parse('2026-12-01T11:00:00Z');
    // "app": primeira leitura logo no boot
    expect(agora().getTime()).toBe(alvo);
    // "worker" (ou o app reiniciado, ou outra camada do Next): primeira leitura 7 min depois no relógio real
    vi.setSystemTime(REAL + 7 * MIN);
    expect(agora().getTime()).toBe(alvo + 7 * MIN);
    expect(agora().getTime() - Date.now()).toBe(alvo - REAL);
  });

  it('valor inválido (inclusive instante ISO): erro claro, sem cair no relógio real em silêncio', () => {
    for (const v of [
      'amanhã', '36h', '+1.5h', '+36w', '+ 1d', ' +1d', '+1d ', '+1234567890s',
      '2026-12-01T08:00:00-03:00', '2026-12-01T08:00:00Z', '2026-12-01',
    ]) {
      vi.stubEnv('E2E_AGORA', v);
      expect(() => agora(), v).toThrow(/^Configuração inválida — E2E_AGORA: deve ser um deslocamento/);
    }
  });

  it('a mensagem não repete o nome da variável', () => {
    vi.stubEnv('E2E_AGORA', '2026-12-01T08:00:00Z');
    let mensagem = '';
    try {
      agora();
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem.match(/E2E_AGORA/g)).toHaveLength(1);
  });

  it('no navegador e sem `process` (service worker) é sempre o relógio real', () => {
    vi.stubEnv('E2E_AGORA', '+36h');
    vi.stubGlobal('window', {});
    expect(agora().getTime()).toBe(REAL);
    vi.unstubAllGlobals();
    const processo = globalThis.process;
    vi.stubGlobal('process', undefined);
    let semProcess: number;
    try {
      semProcess = agora().getTime();
    } finally {
      vi.stubGlobal('process', processo);
    }
    expect(semProcess).toBe(REAL);
    vi.unstubAllGlobals();
    expect(agora().getTime()).toBe(REAL + 36 * HORA);
  });

  it('lerE2eAgora: o deslocamento em ms, ou null', () => {
    expect(lerE2eAgora('+45s')).toBe(45 * SEG);
    expect(lerE2eAgora('+90m')).toBe(90 * MIN);
    expect(lerE2eAgora('+36h')).toBe(36 * HORA);
    expect(lerE2eAgora('-2d')).toBe(-2 * DIA);
    expect(lerE2eAgora('+0s')).toBe(0);
    expect(lerE2eAgora('-999999999s')).toBe(-999_999_999 * SEG);
    expect(lerE2eAgora('36h')).toBeNull();
    expect(lerE2eAgora('2026-12-01T08:00:00-03:00')).toBeNull();
    expect(lerE2eAgora('+99999999d')).toBeNull(); // fora do limite (100 anos): o Date viraria inválido
  });
});

describe('SUS-119 — deslocamentoAte (para o lançador do app e do worker)', () => {
  it('instante ISO com fuso → deslocamento em segundos até ele', () => {
    expect(deslocamentoAte('2026-12-01T08:00:00-03:00', REAL)).toBe(`+${(Date.parse('2026-12-01T11:00:00Z') - REAL) / SEG}s`);
    expect(deslocamentoAte('2026-11-24T15:00:00Z', REAL)).toBe('+0s');
    expect(deslocamentoAte('2026-11-24T14:00:00Z', REAL)).toBe('-3600s');
    expect(deslocamentoAte('2026-11-24T12:00-03:00', REAL)).toBe('+0s');
    expect(deslocamentoAte('2028-02-29T23:59:59.000+00:00', REAL)).toBe(`+${(Date.parse('2028-02-29T23:59:59Z') - REAL) / SEG}s`);
  });

  it('o fuso conta: o mesmo horário de parede em fusos diferentes dá deslocamentos diferentes', () => {
    expect(deslocamentoAte('2026-11-24T15:00:00-03:00', REAL)).toBe('+10800s');
    expect(deslocamentoAte('2026-11-24T15:00:00+01:00', REAL)).toBe('-3600s');
  });

  it('arredonda ao segundo mais próximo, igual para frente e para trás', () => {
    expect(deslocamentoAte('2026-11-24T15:00:01.499Z', REAL)).toBe('+1s');
    expect(deslocamentoAte('2026-11-24T15:00:01.500Z', REAL)).toBe('+2s');
    expect(deslocamentoAte('2026-11-24T14:59:58.500Z', REAL)).toBe('-2s');
    expect(deslocamentoAte('2026-11-24T14:59:58.501Z', REAL)).toBe('-1s');
    expect(deslocamentoAte('2026-11-24T15:00:00Z', REAL + 400)).toBe('+0s');
    expect(deslocamentoAte('2026-11-24T15:00:00Z', REAL + 600)).toBe('-1s');
  });

  it('o resultado é aceito pelo agora() e leva ao instante pedido', () => {
    vi.useFakeTimers({ now: REAL + 123, toFake: ['Date'] });
    try {
      vi.stubEnv('E2E_AGORA', deslocamentoAte('2026-12-25T09:00:00-03:00'));
      expect(agora().getTime()).toBe(Date.parse('2026-12-25T12:00:00Z') + 123);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('instante inválido: sem fuso, só data, data inexistente, hora 24, deslocamento ou longe demais → erro', () => {
    for (const v of [
      '2026-12-01T08:00:00', '2026-12-01', '2026-02-30T08:00:00-03:00', '2027-02-29T08:00:00Z',
      '2026-12-01T24:00:00Z', '+36h', 'amanhã', ' 2026-12-01T08:00:00Z', '2099-12-01T08:00:00Z',
    ]) {
      expect(() => deslocamentoAte(v, REAL), v).toThrow(/^Instante inválido para o relógio do E2E/);
    }
  });
});
