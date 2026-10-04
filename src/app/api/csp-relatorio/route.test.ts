import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a) } }));
const { POST } = await import('./route');

const req = (corpo: string, ip = `10.6.${Math.floor(Math.random() * 250)}.1`) =>
  new Request('http://localhost:3000/api/csp-relatorio', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': ip },
    body: corpo,
  });
const relatorio = (r: Record<string, unknown>) => JSON.stringify({ 'csp-report': r });

beforeEach(() => {
  warn.mockReset();
  process.env.CSP_MODO = 'relatorio';
});
afterEach(() => {
  delete process.env.CSP_MODO;
});

describe('POST /api/csp-relatorio (D7, modo de emergência)', () => {
  it('204 e log só da diretiva e da origem bloqueada (nunca a URL da página nem o caminho bloqueado)', async () => {
    const r = await POST(
      req(
        relatorio({
          'document-uri': 'https://app.exemplo.com/painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b?busca=Ana',
          'effective-directive': 'script-src-elem',
          'violated-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.test/roubar.js?nome=Ana',
        }),
      ),
    );
    expect(r.status).toBe(204);
    expect(warn).toHaveBeenCalledWith({ diretiva: 'script-src-elem', bloqueado: 'https://evil.test' }, 'csp violada');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Ana|pacientes|roubar/);
  });

  it('inline/eval viram "inline"; sem effective-directive usa a primeira palavra da violated-directive', async () => {
    await POST(req(relatorio({ 'violated-directive': "script-src 'self'", 'blocked-uri': 'inline' })));
    expect(warn).toHaveBeenCalledWith({ diretiva: 'script-src', bloqueado: 'inline' }, 'csp violada');
  });

  it.each([
    ['JSON inválido', '{'],
    ['sem csp-report', JSON.stringify({ outro: 1 })],
    ['diretiva com texto livre', relatorio({ 'effective-directive': 'Glicemia 180', 'blocked-uri': 'inline' })],
    ['corpo grande', relatorio({ 'effective-directive': 'img-src', 'blocked-uri': 'inline', x: 'a'.repeat(9000) })],
  ])('%s → 204 e nada no log', async (_n, corpo) => {
    expect((await POST(req(corpo))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('com a CSP valendo (CSP_MODO vazio), nenhum navegador manda relatório: tudo é forjado e nada vai ao log', async () => {
    delete process.env.CSP_MODO;
    const corpo = relatorio({ 'effective-directive': 'img-src', 'blocked-uri': 'https://x.test/a.png' });
    expect((await POST(req(corpo))).status).toBe(204);
    process.env.CSP_MODO = 'valendo';
    expect((await POST(req(corpo))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('limite por IP: o 61º relatório no mesmo minuto não vai ao log', async () => {
    const corpo = relatorio({ 'effective-directive': 'img-src', 'blocked-uri': 'https://x.test/a.png' });
    for (let i = 0; i < 60; i++) await POST(req(corpo, '10.5.5.5'));
    expect(warn).toHaveBeenCalledTimes(60);
    expect((await POST(req(corpo, '10.5.5.5'))).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(60);
  });
});
