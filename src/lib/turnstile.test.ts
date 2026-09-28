import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_SITEVERIFY, verifyTurnstile } from './turnstile';

const resposta = (corpo: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
const secret = '1x0000000000000000000000000000000AA';

describe('verifyTurnstile (INT-06)', () => {
  it('sem token nem chama a Cloudflare', async () => {
    const f = resposta({ success: true });
    expect(await verifyTurnstile(null, { secret, fetchImpl: f })).toBe('invalido');
    expect(await verifyTurnstile('', { secret, fetchImpl: f })).toBe('invalido');
    expect(f).not.toHaveBeenCalled();
  });
  it('sucesso: manda secret, token e IP ao siteverify', async () => {
    const f = resposta({ success: true });
    expect(await verifyTurnstile('tok', { secret, ip: '203.0.113.9', fetchImpl: f })).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY);
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({ secret, response: 'tok', remoteip: '203.0.113.9' });
  });
  it('token recusado → invalido', async () => {
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': ['invalid-input-response'] }) })).toBe('invalido');
  });
  it('Cloudflare fora do ar (erro interno, HTTP 5xx, rede, tempo esgotado) → indisponivel', async () => {
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': ['internal-error'] }) })).toBe('indisponivel');
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({}, 502) })).toBe('indisponivel');
    expect(await verifyTurnstile('tok', { secret, fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) })).toBe('indisponivel');
    const trava = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abortado')))));
    expect(await verifyTurnstile('tok', { secret, fetchImpl: trava as unknown as typeof fetch, timeoutMs: 20 })).toBe('indisponivel');
  });
});
