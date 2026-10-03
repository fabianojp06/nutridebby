import { describe, expect, it, vi } from 'vitest';

const acesso = vi.hoisted(() => ({ atual: null as unknown }));
const pdf = vi.hoisted(() => ({ atual: { estado: 'pendente' } as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requireApiPaciente: async () => acesso.atual }));
vi.mock('@/modules/portal/plano', () => ({ caminhoDoPdf: async () => pdf.atual }));
vi.mock('@/lib/signed-url', () => ({ signFileUrl: (c: string) => `/api/arquivos?c=${c}` }));
const { GET } = await import('./route');

describe('GET /api/p/plano/pdf', () => {
  it('sem sessão: a resposta de recusa', async () => {
    acesso.atual = { ok: false, response: new Response(null, { status: 401 }) };
    expect((await GET(new Request('http://x/api/p/plano/pdf'))).status).toBe(401);
  });
  it('pronto → 303 para a URL assinada; senão → 303 para /p/plano?pdf=preparando', async () => {
    acesso.atual = { ok: true, ctx: {} };
    pdf.atual = { estado: 'pronto', caminho: 't/plano_pdf/a.pdf' };
    const r = await GET(new Request('http://x/api/p/plano/pdf'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/api/arquivos?c=t/plano_pdf/a.pdf');
    pdf.atual = { estado: 'pendente' };
    expect((await GET(new Request('http://x/api/p/plano/pdf'))).headers.get('location')).toBe('/p/plano?pdf=preparando');
  });
});
