import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_SITEVERIFY, verifyTurnstile } from './turnstile';

// Como a Cloudflare responde: JSON com content-type application/json, também nos erros HTTP
const resposta = (corpo: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
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
  it('onFalha que lança não escapa: segue "indisponivel" (M17)', async () => {
    const onFalha = vi.fn(() => {
      throw new Error('logger quebrou');
    });
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({}, 502) })).toBe('indisponivel');
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledTimes(2);
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
  it('segredo inválido/ausente é erro de configuração → indisponivel, com onFalha "config"', async () => {
    for (const codigo of ['invalid-input-secret', 'missing-input-secret']) {
      const onFalha = vi.fn();
      expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': [codigo] }) })).toBe('indisponivel');
      expect(onFalha).toHaveBeenCalledWith({ motivo: 'config', status: 200, codigos: [codigo] });
    }
  });
  it('segredo inválido vem com HTTP 400 (comportamento real da Cloudflare) → onFalha "config" com os códigos', async () => {
    const onFalha = vi.fn();
    const f = resposta({ success: false, 'error-codes': ['invalid-input-secret'], messages: [] }, 400);
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: f })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'config', status: 400, codigos: ['invalid-input-secret'] });
  });
  it('HTTP de erro com códigos que não são de configuração → "http" com status e códigos; nunca "invalido"', async () => {
    const onFalha = vi.fn();
    const f = resposta({ success: false, 'error-codes': ['bad-request'] }, 400);
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: f })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'http', status: 400, codigos: ['bad-request'] });
  });
  it('erro de token com HTTP de erro continua "invalido" (o usuário vê "Confirme que você não é um robô.")', async () => {
    for (const codigo of ['timeout-or-duplicate', 'invalid-input-response']) {
      expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': [codigo] }, 400) })).toBe('invalido');
    }
  });
  it('"error-codes" com tipo inesperado não vira exceção (M17), em 200 ou em HTTP de erro', async () => {
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': 'invalid-input-secret' }) })).toBe('indisponivel');
    const onFalha = vi.fn();
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': { a: 1 } }, 400) })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'http', status: 400 });
  });
  it('códigos vindos de fora vão ao log limitados (no máximo 5, cada um com até 64 caracteres)', async () => {
    const onFalha = vi.fn();
    const muitos = Array.from({ length: 50 }, (_, i) => `codigo-${i}-${'x'.repeat(200)}`);
    await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': muitos }, 400) });
    const { codigos } = onFalha.mock.calls[0][0] as { codigos: string[] };
    expect(codigos).toHaveLength(5);
    expect(codigos.every((c) => c.length <= 64)).toBe(true);
  });
  it('HTTP de erro com corpo que não é JSON (página de proxy) → "http" com o status; o corpo é consumido e descartado', async () => {
    const onFalha = vi.fn();
    const f = vi.fn(async () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: f })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'http', status: 502 });
  });
  it('classifica pela lista inteira de códigos: segredo errado depois de 5 códigos de token ainda é "config"', async () => {
    const onFalha = vi.fn();
    const codigos = ['timeout-or-duplicate', 'invalid-input-response', 'missing-input-response', 'timeout-or-duplicate', 'invalid-input-response', 'invalid-input-secret'];
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': codigos }, 400) })).toBe('indisponivel');
    expect(onFalha.mock.calls[0][0]).toMatchObject({ motivo: 'config', status: 400 });
  });
  it('mesmo código, mesma classificação em 200 ou HTTP de erro: código desconhecido é falha nossa, com log', async () => {
    for (const status of [200, 400]) {
      const onFalha = vi.fn();
      expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': ['bad-request'] }, status) })).toBe('indisponivel');
      expect(onFalha).toHaveBeenCalledWith({ motivo: 'http', status, codigos: ['bad-request'] });
    }
  });
  it('"internal-error" também leva o status', async () => {
    const onFalha = vi.fn();
    await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false, 'error-codes': ['internal-error'] }) });
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'http', status: 200, codigos: ['internal-error'] });
  });
  it('corpo JSON de erro é lido mesmo sem content-type de JSON', async () => {
    const onFalha = vi.fn();
    const f = vi.fn(async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }), { status: 400, headers: { 'content-type': 'text/plain' } }));
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: f })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'config', status: 400, codigos: ['invalid-input-secret'] });
  });
  it('200 sem sucesso e sem nenhum código → indisponivel (motivo "resposta"), não "robô"', async () => {
    const onFalha = vi.fn();
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: resposta({ success: false }) })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'resposta', status: 200 });
  });
  it('200 com corpo que não é JSON → indisponivel (motivo "resposta")', async () => {
    const onFalha = vi.fn();
    const f = vi.fn(async () => new Response('<html>oops</html>', { status: 200 }));
    expect(await verifyTurnstile('tok', { secret, onFalha, fetchImpl: f })).toBe('indisponivel');
    expect(onFalha).toHaveBeenCalledWith({ motivo: 'resposta', status: 200 });
  });
  it('onFalha informa rede, timeout e http sem vazar token/segredo', async () => {
    const onFalha = vi.fn();
    await verifyTurnstile('tok-secreto', { secret, onFalha, fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) });
    await verifyTurnstile('tok-secreto', { secret, onFalha, fetchImpl: resposta({}, 502) });
    expect(onFalha.mock.calls.map((c) => c[0])).toEqual([{ motivo: 'rede' }, { motivo: 'http', status: 502 }]);
    expect(JSON.stringify(onFalha.mock.calls)).not.toMatch(/tok-secreto|1x0000/);
  });
});
