import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Plano 23 (AG-D42, AG-D48, AG-D49): o POST do formulário "Desistir do pedido" (sem JS) — grava e volta à página (303). */
const desistir = vi.hoisted(() => vi.fn());
vi.mock('@/modules/agenda/agendamento-publico', () => ({ desistirDoPedidoPublico: desistir }));
vi.mock('@/env', () => ({ getEnv: () => ({ APP_URL: 'https://app.exemplo.com', TRUSTED_PROXIES: [] }) }));
vi.mock('@serwist/turbopack', () => ({ withSerwist: <T,>(c: T) => c }));

const { POST } = await import('./route');
const { default: nextConfig } = await import('../../../../../../../next.config');

const TOKEN = 'b'.repeat(43);
const chamar = (slug: string, token: string) =>
  POST(new Request(`https://app.exemplo.com/api/n/${slug}/pedido/${token}`, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.9' } }), { params: Promise.resolve({ slug, token }) });

beforeEach(() => desistir.mockReset());

describe('POST /api/n/[slug]/pedido/[token]', () => {
  it('grava (confirmar: true) e redireciona (303) para a página com ?ok=1, sem cache', async () => {
    desistir.mockResolvedValue({ estado: 'cancelado', quando: 'x' });
    const r = await chamar('debby', TOKEN);
    expect(desistir).toHaveBeenCalledWith('debby', TOKEN, expect.objectContaining({ confirmar: true }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`https://app.exemplo.com/n/debby/pedido/${TOKEN}?ok=1`);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('inválido também volta à página (que diz "Este link não é válido."); limite por IP → ?erro=limite', async () => {
    desistir.mockResolvedValue({ estado: 'invalido' });
    expect((await chamar('debby', TOKEN)).headers.get('location')).toBe(`https://app.exemplo.com/n/debby/pedido/${TOKEN}?ok=1`);
    desistir.mockResolvedValue({ estado: 'limite' });
    const r = await chamar('debby', TOKEN);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe(`https://app.exemplo.com/n/debby/pedido/${TOKEN}?erro=limite`);
  });

  it('slug ou token fora do formato → 404, sem chamar o módulo (nada do visitante vai ao Location)', async () => {
    for (const [slug, token] of [['Debby/../x', TOKEN], ['debby', 'curto'], ['debby', `${TOKEN}%0d%0a`]]) {
      expect((await chamar(slug, token)).status).toBe(404);
    }
    expect(desistir).not.toHaveBeenCalled();
  });

  it('next.config.ts: a rota do token sem Referer e sem cache (AG-D71)', async () => {
    const regras = await nextConfig.headers!();
    const r = regras.find((x) => x.source === '/api/n/:slug/pedido/:token*');
    expect(r?.headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }]));
  });
});
