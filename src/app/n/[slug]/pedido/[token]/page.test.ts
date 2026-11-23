import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Plano 23 (AG-D42, AG-D48, AG-D49, AG-D71): a página do link "Desistir do pedido" da pessoa nova. */
const desistir = vi.hoisted(() => vi.fn());
vi.mock('@/modules/agenda/agendamento-publico', () => ({ desistirDoPedidoPublico: desistir }));
vi.mock('@serwist/turbopack', () => ({ withSerwist: <T,>(c: T) => c })); // só a configuração do Next
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.23' }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ TRUSTED_PROXIES: [] }) }));

const { default: PaginaDoPedido } = await import('./page');
const { default: nextConfig } = await import('../../../../../../next.config');

const TOKEN = 'a'.repeat(43);
const QUANDO = 'sex., 16/10/2026 às 09:00 (horário de Brasília)';
const render = async (searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaDoPedido({ params: Promise.resolve({ slug: 'debby', token: TOKEN }), searchParams: Promise.resolve(searchParams) } as never));

beforeEach(() => desistir.mockReset());

describe('/n/[slug]/pedido/[token]', () => {
  it('aguardando: "Seu pedido de consulta", a pergunta e o botão num formulário POST (sem JS) para a rota; o GET não grava (confirmar: false)', async () => {
    desistir.mockResolvedValue({ estado: 'aguardando', quando: QUANDO });
    const html = await render();
    expect(desistir).toHaveBeenCalledWith('debby', TOKEN, expect.objectContaining({ confirmar: false }));
    expect(html).toContain('<h1');
    expect(html).toContain('Seu pedido de consulta');
    expect(html).toContain(`Desistir do pedido de ${QUANDO}?`);
    expect(html).toMatch(new RegExp(`<form[^>]*method="post"[^>]*action="/api/n/debby/pedido/${TOKEN}"|<form[^>]*action="/api/n/debby/pedido/${TOKEN}"[^>]*method="post"`));
    expect(html).toMatch(/<button[^>]*>Desistir do pedido<\/button>/);
  });

  it('cancelado: "Pedido cancelado." numa região de status; inválido: "Este link não é válido."; muitas tentativas', async () => {
    desistir.mockResolvedValue({ estado: 'cancelado', quando: QUANDO });
    const c = await render({ ok: '1' });
    expect(c).toMatch(/role="status"[^>]*>Pedido cancelado\.</);
    expect(c).not.toContain('<form');
    desistir.mockResolvedValue({ estado: 'invalido' });
    const i = await render();
    expect(i).toContain('Este link não é válido.');
    expect(i).not.toContain('<form');
    desistir.mockResolvedValue({ estado: 'aguardando', quando: QUANDO });
    expect(await render({ erro: 'limite' })).toContain('Muitas tentativas. Tente novamente mais tarde.');
  });

  it('revisão da T7 (M3): acima do limite, só a mensagem de limite, sem formulário', async () => {
    desistir.mockResolvedValue({ estado: 'limite' });
    const html = await render();
    expect(desistir).toHaveBeenCalledWith('debby', TOKEN, expect.objectContaining({ confirmar: false }));
    expect(html).toContain('Muitas tentativas. Tente novamente mais tarde.');
    expect(html).not.toContain('<form');
  });

  it('next.config.ts: no-referrer + no-store na página e na rota do token, depois da regra /:path* (AG-D71)', async () => {
    const regras = await nextConfig.headers!();
    const geral = regras.findIndex((r) => r.source === '/:path*');
    for (const source of ['/n/:slug/pedido/:token*', '/api/n/:slug/pedido/:token*']) {
      const i = regras.findIndex((r) => r.source === source);
      expect(i, source).toBeGreaterThan(geral);
      expect(regras[i].headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }]));
    }
  });
});
