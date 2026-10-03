import { describe, expect, it, vi } from 'vitest';

const acesso = vi.hoisted(() => ({ atual: null as unknown, registrado: 0, cookie: 'nd.session_token=x; Max-Age=2592000' as string | null }));
vi.mock('@/lib/paciente-session', () => ({ requireApiPaciente: async () => acesso.atual }));
vi.mock('@/modules/portal/acesso', () => ({
  registrarAcesso: async () => {
    acesso.registrado++;
    return true;
  },
}));
vi.mock('@/lib/sessao-cookies', () => ({ cookieDeSessaoRenovado: async () => acesso.cookie }));
vi.mock('@/lib/auth', () => ({ getAuth: () => ({}) }));
vi.mock('@/env', () => ({ getEnv: () => ({ APP_URL: 'http://localhost:3000' }) }));
const { POST } = await import('./route');

const pedido = (origin: string | null = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/p/acesso', { method: 'POST', headers: origin ? { origin } : {} });

describe('POST /api/p/acesso', () => {
  it('outra origem → 403 sem registrar; sem sessão → a recusa', async () => {
    acesso.atual = { ok: true, ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } };
    expect((await POST(pedido('https://evil.example'))).status).toBe(403);
    expect(acesso.registrado).toBe(0);
    acesso.atual = { ok: false, response: new Response(null, { status: 401 }) };
    expect((await POST(pedido())).status).toBe(401);
    expect(acesso.registrado).toBe(0);
  });

  it('registra o dia e renova o cookie (204, sem cache)', async () => {
    acesso.atual = { ok: true, ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } };
    const r = await POST(pedido());
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=2592000');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(acesso.registrado).toBe(1);
  });

  it('sem Origin (mesmo site) também registra; sem o cookie para renovar, 204 sem Set-Cookie', async () => {
    acesso.atual = { ok: true, ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } };
    acesso.cookie = null;
    const r = await POST(pedido(null));
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});
