/** RNF-06 (D7): CSP por nonce (guia content-security-policy.md do Next 16) e cabeçalhos globais (D8). */
export type ModoCsp = 'valendo' | 'relatorio';
export const ROTA_RELATORIO_CSP = '/api/csp-relatorio';
/** Plano 07 (D10): players sem cookies; INT-06: o widget do Turnstile. */
export const FRAMES_PERMITIDOS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://challenges.cloudflare.com'] as const;

export const novoNonce = (): string => Buffer.from(crypto.randomUUID()).toString('base64');

export function montarCsp(o: { nonce: string; dev: boolean; https: boolean; modo: ModoCsp }): {
  nome: 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only';
  valor: string;
} {
  const d = [
    "default-src 'self'",
    // 'strict-dynamic': o que um script com nonce carrega (o api.js do Turnstile pelo next/script) também vale;
    // o host do Turnstile fica como reserva para navegador sem strict-dynamic
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic' https://challenges.cloudflare.com${o.dev ? " 'unsafe-eval'" : ''}`,
    // atributos style do React (cor da marca, gráficos): não há como pôr nonce em atributo
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", // capas e logos locais (/api/arquivos), QR do 2FA (data:), prévia da foto do diário (blob:)
    "font-src 'self'", // next/font serve as fontes do próprio app
    "connect-src 'self'", // D1: o navegador não fala com o Sentry
    `frame-src ${FRAMES_PERMITIDOS.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (o.https) d.push('upgrade-insecure-requests');
  if (o.modo === 'relatorio') d.push(`report-uri ${ROTA_RELATORIO_CSP}`);
  return { nome: o.modo === 'relatorio' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', valor: d.join('; ') };
}

/** Todas as rotas (next.config.ts). HSTS em resposta http é ignorado pelo navegador: pode ir sempre. */
export const CABECALHOS_SEGURANCA = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
];
