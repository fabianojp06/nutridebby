import { describe, expect, it } from 'vitest';
import { custoMaximoDoArquivo, custoMaximoMicroUsd, custoMicroUsd, reservaDaLeitura } from './precos';

describe('preços (spec §6, 06/10/2026) — micro-dólares inteiros, região us = ×1,1', () => {
  it('laudo de 3 páginas no Opus 5.5 us (~19 mil de entrada, 4 mil de saída) ≈ US$ 0,17', () => {
    const c = custoMicroUsd('claude-opus-5-5', 'us', { entrada: 19_000, cacheLeitura: 0, cacheGravacao: 0, saida: 4_000, geo: 'us' });
    expect(c).toBe(Math.ceil((19_000 * 4 + 4_000 * 20) * 1.1)); // 171.600 µUS$
  });

  it('Sonnet 5.5 custa metade; global sem acréscimo; cache lido e gravado entram', () => {
    expect(custoMicroUsd('claude-sonnet-5-5', 'global', { entrada: 1_000_000, cacheLeitura: 1_000_000, cacheGravacao: 1_000_000, saida: 1_000_000, geo: null })).toBe(2_000_000 + 200_000 + 2_500_000 + 10_000_000);
  });

  it('reserva do app (RN-104): PDF pelo teto de 15 páginas; foto pelo teto de uma imagem', () => {
    expect(reservaDaLeitura('claude-opus-5-5', 'us', 'pdf')).toBe(custoMaximoMicroUsd('claude-opus-5-5', 'us', 15 * 8700 + 3000, 16_000));
    expect(reservaDaLeitura('claude-opus-5-5', 'us', 'pdf')).toBe(Math.ceil((133_500 * 4 + 16_000 * 20) * 1.1)); // ≈ US$ 0,94
    expect(reservaDaLeitura('claude-opus-5-5', 'us', 'imagem')).toBe(Math.ceil(((4784 + 3000) * 4 + 16_000 * 20) * 1.1)); // ≈ US$ 0,39
  });

  it('teto pelas páginas contadas (portão do envio): nunca passa da reserva do app', () => {
    expect(custoMaximoDoArquivo('claude-opus-5-5', 'us', { tipo: 'pdf', paginas: 2 })).toBe(custoMaximoMicroUsd('claude-opus-5-5', 'us', 2 * 8700 + 3000, 16_000));
    expect(custoMaximoDoArquivo('claude-opus-5-5', 'us', { tipo: 'pdf', paginas: 15 })).toBe(reservaDaLeitura('claude-opus-5-5', 'us', 'pdf'));
    expect(custoMaximoDoArquivo('claude-opus-5-5', 'us', { tipo: 'imagem' })).toBe(reservaDaLeitura('claude-opus-5-5', 'us', 'imagem'));
  });
});
