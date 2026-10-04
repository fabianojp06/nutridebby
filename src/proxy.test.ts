import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedirectUrl } from 'next/experimental/testing/server';
import { proxy } from './proxy';

describe('proxy', () => {
  it('rota protegida sem cookie vai para /entrar preservando caminho e query em ?volta', () => {
    const res = proxy(new NextRequest('http://localhost:3100/painel/pacientes?busca=ana&pagina=2'));
    const url = new URL(getRedirectUrl(res)!);
    expect(url.pathname).toBe('/entrar');
    expect(url.searchParams.get('volta')).toBe('/painel/pacientes?busca=ana&pagina=2');
  });

  it('rota protegida com cookie de sessão segue adiante', () => {
    const req = new NextRequest('http://localhost:3100/painel', { headers: { cookie: 'nd.session_token=abc.def' } });
    expect(getRedirectUrl(proxy(req))).toBeNull();
  });

  it('rota pública segue adiante sem cookie', () => {
    expect(getRedirectUrl(proxy(new NextRequest('http://localhost:3100/entrar')))).toBeNull();
  });

  it('repassa caminho + query (sem _rsc) no cabeçalho x-nd-caminho, sobrescrevendo o do cliente', () => {
    const req = new NextRequest('http://localhost:3100/painel/pacientes?busca=ana&_rsc=abc', {
      headers: { cookie: 'nd.session_token=abc.def', 'x-nd-caminho': '//evil.com' },
    });
    const res = proxy(req);
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-nd-caminho');
    expect(res.headers.get('x-middleware-request-x-nd-caminho')).toBe('/painel/pacientes?busca=ana');
  });

  it('?volta do redirecionamento também não leva o _rsc', () => {
    const url = new URL(getRedirectUrl(proxy(new NextRequest('http://localhost:3100/painel?_rsc=xyz')))!);
    expect(url.searchParams.get('volta')).toBe('/painel');
  });

  it('D2: página e Server Action ganham x-request-id novo (repassado e devolvido), sobrescrevendo o do cliente', () => {
    for (const url of ['http://localhost:3100/entrar', 'http://localhost:3100/painel/pacientes?busca=ana']) {
      const res = proxy(new NextRequest(url, { headers: { 'x-request-id': 'forjado', cookie: 'nd.session_token=abc.def' } }));
      const repassado = res.headers.get('x-middleware-request-x-request-id');
      expect(repassado, url).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.get('x-request-id'), url).toBe(repassado);
    }
  });

  it('D2: o matcher continua sem /api (o Next bufferizaria o corpo, com corte em 10 MB) e fora de estáticos e do service worker', async () => {
    const { config } = await import('./proxy');
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/entrar')).toBe(true);
    expect(re.test('/painel/pacientes/x/exames')).toBe(true); // a página, não a API
    for (const fora of ['/api/health', '/api/painel/pacientes/x/exames', '/api/p/diario', '/api/erro-cliente', '/_next/static/chunks/a.js', '/serwist/sw.js']) {
      expect(re.test(fora), fora).toBe(false);
    }
  });

  it('D7: página ganha CSP com nonce novo, repassada ao Next (request) e devolvida (response)', () => {
    const a = proxy(new NextRequest('http://localhost:3100/entrar'));
    const b = proxy(new NextRequest('http://localhost:3100/entrar'));
    const csp = a.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(b.headers.get('content-security-policy')).not.toBe(csp);
    // /api/* não chega ao proxy (matcher, D2): o teste do matcher da Tarefa 1 continua valendo
  });

  it('CSP_MODO=relatorio troca para Report-Only', () => {
    process.env.CSP_MODO = 'relatorio';
    try {
      const r = proxy(new NextRequest('http://localhost:3100/entrar'));
      expect(r.headers.get('content-security-policy')).toBeNull();
      expect(r.headers.get('content-security-policy-report-only')).toContain('report-uri /api/csp-relatorio');
      // CSP mandada pelo cliente não chega ao Next (ele leria o nonce dela antes do Report-Only)
      const forjada = proxy(
        new NextRequest('http://localhost:3100/entrar', { headers: { 'content-security-policy': "script-src 'nonce-forjado'" } }),
      );
      expect(forjada.headers.get('x-middleware-override-headers')).not.toMatch(/(^|,)content-security-policy(,|$)/);
      expect(forjada.headers.get('x-middleware-request-content-security-policy')).toBeNull();
      expect(forjada.headers.get('x-middleware-request-content-security-policy-report-only')).toContain("'nonce-");
    } finally {
      delete process.env.CSP_MODO;
    }
  });
});
