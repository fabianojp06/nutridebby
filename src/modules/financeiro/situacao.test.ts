import { describe, expect, it } from 'vitest';
import { ROTULO_SITUACAO, dataDeReferencia, situacaoDoLancamento } from './situacao';

const HOJE = '2026-11-16';
const base = { tipo: 'entrada' as const, vencimento: HOJE, pagoEm: null, canceladoEm: null };

/** RN-305: cancelado → pago → vencido antes de hoje → previsto. */
describe('situacaoDoLancamento', () => {
  it('vencimento hoje, em aberto → previsto', () => {
    expect(situacaoDoLancamento(base, HOJE)).toBe('previsto');
  });

  it('vencimento depois de hoje, em aberto → previsto', () => {
    expect(situacaoDoLancamento({ ...base, vencimento: '2026-12-01' }, HOJE)).toBe('previsto');
  });

  it('vencimento ontem, em aberto → em atraso', () => {
    expect(situacaoDoLancamento({ ...base, vencimento: '2026-11-15' }, HOJE)).toBe('em_atraso');
    expect(situacaoDoLancamento({ ...base, tipo: 'saida', vencimento: '2026-11-15' }, HOJE)).toBe('em_atraso');
  });

  it('entrada paga → recebido; saída paga → pago (mesmo vencida)', () => {
    expect(situacaoDoLancamento({ ...base, vencimento: '2026-10-01', pagoEm: '2026-11-10' }, HOJE)).toBe('recebido');
    expect(situacaoDoLancamento({ ...base, tipo: 'saida', vencimento: '2026-10-01', pagoEm: '2026-11-10' }, HOJE)).toBe('pago');
  });

  it('cancelado vence tudo', () => {
    const canceladoEm = new Date('2026-11-16T12:00:00Z');
    expect(situacaoDoLancamento({ ...base, canceladoEm }, HOJE)).toBe('cancelado');
    expect(situacaoDoLancamento({ ...base, vencimento: '2026-01-01', canceladoEm }, HOJE)).toBe('cancelado');
    expect(situacaoDoLancamento({ ...base, pagoEm: '2026-11-10', canceladoEm }, HOJE)).toBe('cancelado');
    expect(situacaoDoLancamento({ ...base, tipo: 'saida', pagoEm: '2026-11-10', canceladoEm }, HOJE)).toBe('cancelado');
  });
});

/** RN-306: pago conta pela data do pagamento; em aberto, pelo vencimento. */
describe('dataDeReferencia', () => {
  it('pela data de pagamento quando há', () => {
    expect(dataDeReferencia({ vencimento: '2026-10-31', pagoEm: '2026-11-02' })).toBe('2026-11-02');
  });
  it('pelo vencimento quando não há', () => {
    expect(dataDeReferencia({ vencimento: '2026-10-31', pagoEm: null })).toBe('2026-10-31');
  });
});

describe('ROTULO_SITUACAO', () => {
  it('os textos da spec §6.2 (Situações)', () => {
    expect(ROTULO_SITUACAO).toEqual({ previsto: 'Previsto', em_atraso: 'Em atraso', recebido: 'Recebido', pago: 'Pago', cancelado: 'Cancelado' });
  });
});
