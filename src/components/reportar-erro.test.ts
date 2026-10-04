import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportarErro } from './reportar-erro';

const fetchFalso = vi.fn(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  fetchFalso.mockClear();
  vi.stubGlobal('location', { pathname: '/painel/agenda' });
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => vi.unstubAllGlobals());

const erro = Object.assign(new TypeError('Glicemia 180 de Ana Souza'), { digest: '1234567' });
const corpoEsperado = JSON.stringify({ digest: '1234567', nome: 'TypeError', rota: '/painel/agenda' });

describe('reportarErro (D1; achado 1 do /code-review do PR #12)', () => {
  it('sendBeacon com Blob text/plain (CORS-safelisted: o Chrome lança SecurityError com application/json) e sem fetch', async () => {
    const enviados: { url: string; dado: Blob }[] = [];
    vi.stubGlobal('navigator', { sendBeacon: (url: string, dado: Blob) => (enviados.push({ url, dado }), true) });
    reportarErro(erro);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toBe('/api/erro-cliente');
    expect(enviados[0].dado.type).toBe('text/plain');
    expect(await enviados[0].dado.text()).toBe(corpoEsperado);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it.each([
    ['sendBeacon lança (SecurityError)', { sendBeacon: () => { throw new DOMException('tipo não permitido', 'SecurityError'); } }],
    ['sendBeacon recusa (fila cheia)', { sendBeacon: () => false }],
    ['sem sendBeacon', {}],
  ])('%s → o fetch de reserva leva o erro', (_n, nav) => {
    vi.stubGlobal('navigator', nav);
    reportarErro(erro);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso).toHaveBeenCalledWith('/api/erro-cliente', expect.objectContaining({ method: 'POST', body: corpoEsperado, keepalive: true }));
  });

  it('nunca lança, nem com o fetch quebrado', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', () => {
      throw new Error('sem rede');
    });
    expect(() => reportarErro(erro)).not.toThrow();
  });
});
