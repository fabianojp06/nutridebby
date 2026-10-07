import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { ACOMPANHAR_PDF_MAX_MS, acompanharEstadoPdf, mudou, POLL_ESTADO_PDF_MS } from './acompanhar-estado-pdf';

const resposta = (e: { status: string; pdfStatus?: string | null; digitalizacaoStatus?: string | null }) =>
  ({ ok: true, json: async () => ({ pdfStatus: null, digitalizacaoStatus: null, ...e }) }) as Response;

describe('"Preparando o PDF…" / "Montando o PDF digitalizado…" (T6/T9, P12-14)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mudou: o PDF sai de "preparando" ou falha; a digitalizada deixa de estar em curso', () => {
    expect(mudou({ status: 'preparando', pdfStatus: 'pendente', digitalizacaoStatus: null }, 'pdf')).toBe(false);
    expect(mudou({ status: 'preparando', pdfStatus: 'falhou', digitalizacaoStatus: null }, 'pdf')).toBe(true);
    expect(mudou({ status: 'preparando', pdfStatus: 'sem_cota', digitalizacaoStatus: null }, 'pdf')).toBe(true);
    expect(mudou({ status: 'aguardando_assinatura', pdfStatus: 'pronto', digitalizacaoStatus: null }, 'pdf')).toBe(true);
    expect(mudou({ status: 'aguardando_assinatura', pdfStatus: 'pronto', digitalizacaoStatus: 'pendente' }, 'digitalizacao')).toBe(false);
    expect(mudou({ status: 'aguardando_assinatura', pdfStatus: 'pronto', digitalizacaoStatus: 'falhou' }, 'digitalizacao')).toBe(true);
    expect(mudou({ status: 'assinado', pdfStatus: 'pronto', digitalizacaoStatus: 'pronto' }, 'digitalizacao')).toBe(true);
  });

  it('consulta a cada 3 s com o cabeçalho de consulta automática (não é uso) e recarrega uma vez quando muda', async () => {
    let n = 0;
    const buscar = vi.fn(async () => resposta(++n >= 3 ? { status: 'aguardando_assinatura' } : { status: 'preparando', pdfStatus: 'pendente' }));
    const aoMudar = vi.fn();
    acompanharEstadoPdf('d1', 'pdf', aoMudar, buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(3 * POLL_ESTADO_PDF_MS);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(buscar).toHaveBeenCalledWith('/api/painel/documentos/d1/pdf?estado=1', CONSULTA_AUTOMATICA);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it('worker parado (sempre "preparando"), sem rede ou 401: para de consultar no prazo de 1 h, sem recarregar', async () => {
    const buscar = vi.fn(async () => {
      const i = buscar.mock.calls.length % 3;
      if (i === 0) throw new TypeError('sem rede');
      return i === 1 ? resposta({ status: 'preparando', pdfStatus: 'pendente' }) : ({ ok: false, status: 401 } as Response);
    });
    const aoMudar = vi.fn();
    acompanharEstadoPdf('d2', 'pdf', aoMudar, buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(ACOMPANHAR_PDF_MAX_MS + 60_000);
    const total = buscar.mock.calls.length;
    expect(total).toBe(ACOMPANHAR_PDF_MAX_MS / POLL_ESTADO_PDF_MS);
    await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    expect(buscar).toHaveBeenCalledTimes(total);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it('desmontar o componente para de consultar', async () => {
    const buscar = vi.fn(async () => resposta({ status: 'aguardando_assinatura', digitalizacaoStatus: 'recebendo' }));
    const parar = acompanharEstadoPdf('d3', 'digitalizacao', vi.fn(), buscar as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(9000);
    parar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(buscar).toHaveBeenCalledTimes(3);
  });
});
