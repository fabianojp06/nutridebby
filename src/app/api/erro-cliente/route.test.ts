import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturar = vi.fn();
vi.mock('@/lib/sentry', () => ({ capturarErroDoNavegador: (e: unknown) => capturar(e) }));
const { POST } = await import('./route');

const req = (corpo: string, h: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/erro-cliente', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.1`, ...h }, body: corpo });

beforeEach(() => capturar.mockReset());

describe('POST /api/erro-cliente (D1)', () => {
  it('204 e repassa só digest, nome e rota segura', async () => {
    const r = await POST(req(JSON.stringify({ digest: '1234567', nome: 'TypeError', rota: '/painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b?busca=Ana' })));
    expect(r.status).toBe(204);
    expect(capturar).toHaveBeenCalledWith({ digest: '1234567', nome: 'TypeError', rota: '/painel/pacientes/:id' });
  });
  it.each([
    ['outra origem', JSON.stringify({ nome: 'TypeError', rota: '/p' }), { origin: 'https://evil.test' }, 403],
    ['corpo grande', JSON.stringify({ nome: 'TypeError', rota: `/${'a'.repeat(3000)}` }), {}, 413],
    ['JSON inválido', '{', {}, 400],
    ['nome com texto livre', JSON.stringify({ nome: 'Glicemia 180', rota: '/p' }), {}, 400],
    ['digest fora do formato', JSON.stringify({ digest: 'Ana Souza', nome: 'Error', rota: '/p' }), {}, 400],
  ])('%s → %i e nada vai ao Sentry', async (_n, corpo, h, status) => {
    expect((await POST(req(corpo, h as Record<string, string>))).status).toBe(status);
    expect(capturar).not.toHaveBeenCalled();
  });
  it('limite por IP: a 21ª no mesmo minuto dá 429', async () => {
    const ip = { 'x-forwarded-for': '10.8.8.8' };
    const corpo = JSON.stringify({ nome: 'Error', rota: '/p' });
    for (let i = 0; i < 20; i++) await POST(req(corpo, ip));
    expect((await POST(req(corpo, ip))).status).toBe(429);
  });
});
