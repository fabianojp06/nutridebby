import { describe, expect, it } from 'vitest';
import { CABECALHOS_SEGURANCA, montarCsp, novoNonce } from './csp';

const diretiva = (csp: string, nome: string) => csp.split('; ').find((d) => d.startsWith(`${nome} `) || d === nome);

describe('CSP (RNF-06, D7)', () => {
  const { nome, valor } = montarCsp({ nonce: 'abc123', dev: false, https: true, modo: 'valendo' });
  it('vale de verdade, com nonce + strict-dynamic e o Turnstile como reserva', () => {
    expect(nome).toBe('Content-Security-Policy');
    expect(diretiva(valor, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://challenges.cloudflare.com");
  });
  it('frames só do YouTube sem cookies, do Vimeo e do Turnstile (Plano 07, D10)', () => {
    expect(diretiva(valor, 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com');
  });
  it.each([
    ["default-src 'self'"],
    ["img-src 'self' data: blob:"],
    ["connect-src 'self'"],
    ["object-src 'none'"],
    ["base-uri 'none'"],
    ["form-action 'self'"],
    ["frame-ancestors 'none'"],
    ["worker-src 'self'"],
    ['upgrade-insecure-requests'],
  ])('tem %s', (d) => expect(valor.split('; ')).toContain(d));
  it("sem 'unsafe-eval' em produção; com ele só em dev; sem upgrade-insecure-requests em http (E2E local)", () => {
    expect(valor).not.toContain('unsafe-eval');
    const dev = montarCsp({ nonce: 'n', dev: true, https: false, modo: 'valendo' }).valor;
    expect(diretiva(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
  it('modo relatório: outro cabeçalho e report-uri da rota própria', () => {
    const r = montarCsp({ nonce: 'n', dev: false, https: true, modo: 'relatorio' });
    expect(r.nome).toBe('Content-Security-Policy-Report-Only');
    expect(r.valor).toContain('report-uri /api/csp-relatorio');
  });
  it('nonce: 128 bits em base64, diferente a cada chamada', () => {
    const [a, b] = [novoNonce(), novoNonce()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it('cabeçalhos globais (D8: HSTS sem includeSubDomains)', () => {
    expect(CABECALHOS_SEGURANCA).toEqual([
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
    ]);
  });
});
