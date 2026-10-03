import { afterEach, describe, expect, it, vi } from 'vitest';
import { chaveCompras } from './(portal)/compras/marcacao';
import { limparAparelho } from './sair-portal';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('"Sair" do portal limpa o aparelho (Review Focus 4)', () => {
  it('rede lenta: o unsubscribe do push não espera o DELETE (roda junto); as marcações "comprado" saem; o prazo de 2 s vale', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn(async () => true);
    const sub = { endpoint: 'https://push.example/abc', unsubscribe };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } });
    const fetch = vi.fn(() => new Promise<Response>(() => undefined)); // o DELETE nunca responde
    vi.stubGlobal('fetch', fetch);
    const guardado = new Map([[chaveCompras('plano-a'), '["Arroz"]']]);
    vi.stubGlobal('localStorage', {
      get length() {
        return guardado.size;
      },
      key: (i: number) => [...guardado.keys()][i] ?? null,
      getItem: (k: string) => guardado.get(k) ?? null,
      removeItem: (k: string) => void guardado.delete(k),
      setItem: (k: string, v: string) => void guardado.set(k, v),
      clear: () => guardado.clear(),
    });
    const fim = limparAparelho();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith('/api/p/push', expect.objectContaining({ method: 'DELETE', keepalive: true }));
    expect(unsubscribe).toHaveBeenCalled(); // antes de o DELETE responder
    expect(guardado.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(fim).resolves.toBeUndefined();
  });
});
