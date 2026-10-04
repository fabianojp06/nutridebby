import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// S-5 (débitos pré-go-live): "Entrar (já sou paciente)" leva o consultório (?v=) — com 2+ vínculos, abre a agenda do
// consultório desta página, não o do cookie.
const carregar = vi.hoisted(() => vi.fn());
vi.mock('@/modules/agenda/agendamento-publico', () => ({ carregarPaginaPublica: carregar }));
vi.mock('./agendar-form', () => ({ AgendarForm: () => '[AgendarForm]' }));
vi.mock('@/env', () => ({ getEnv: () => ({ TURNSTILE_SITE_KEY: 'k' }) }));

const { default: PaginaPublica } = await import('./page');

const ATIVA = {
  estado: 'ativa',
  tenantId: '0b6f4a52-6c63-4a39-9d52-6a3b8a0e1f11',
  nome: 'Debby Silva',
  temOnline: false,
  semana: '2026-10-12',
  primeira: '2026-10-12',
  ultima: '2026-12-01',
  horarios: [],
};
const render = async () =>
  renderToStaticMarkup(await PaginaPublica({ params: Promise.resolve({ slug: 'debby' }), searchParams: Promise.resolve({}) } as never));

beforeEach(() => carregar.mockReset());

describe('/n/[slug]: "Entrar (já sou paciente)"', () => {
  it('vai a /p/agenda com o consultório da página (?v=)', async () => {
    carregar.mockResolvedValue(ATIVA);
    const html = await render();
    expect(html).toContain(`href="/p/agenda?v=${ATIVA.tenantId}"`);
    expect(html).toContain('Entrar (já sou paciente)');
  });
});
