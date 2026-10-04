import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { montarCsp, novoNonce } from '@/lib/csp';
import { CABECALHO_REQUEST_ID, novoRequestId } from '@/lib/request-id';
import { CURRENT_PATH_HEADER } from '@/lib/safe-return';

const PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio'];

/** Caminho + query da página pedida, sem o `_rsc` interno das navegações do App Router. */
function currentPath(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('_rsc');
  const qs = params.toString();
  return qs ? `${req.nextUrl.pathname}?${qs}` : req.nextUrl.pathname;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = novoRequestId(); // D2: o do cliente nunca é usado
  // /api/* não passa por aqui (matcher): sem CSP de documento; o id das APIs nasce no onRequestError (Tarefa 2)
  const current = currentPath(req);
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', current); // /entrar valida com safeReturnPath
    return NextResponse.redirect(url);
  }
  // D7: o Next lê o nonce do cabeçalho de CSP da requisição e o aplica aos próprios scripts
  const nonce = novoNonce();
  const csp = montarCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: (process.env.APP_URL ?? '').startsWith('https://'),
    modo: process.env.CSP_MODO === 'relatorio' ? 'relatorio' : 'valendo',
  });
  const headers = new Headers(req.headers);
  headers.set(CURRENT_PATH_HEADER, current); // requireUser: sessão expirada → /entrar mantendo o ?volta
  headers.set(CABECALHO_REQUEST_ID, requestId);
  headers.set('x-nonce', nonce); // para quem precisar do nonce num <Script> (headers().get('x-nonce'))
  // o Next tira o nonce do primeiro destes que achar: um mandado pelo cliente nunca pode sobrar (no modo relatório
  // só o Report-Only seria trocado, e o Next leria o Content-Security-Policy forjado antes dele)
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  headers.set(csp.nome, csp.valor);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(csp.nome, csp.valor);
  res.headers.set(CABECALHO_REQUEST_ID, requestId);
  return res;
}

// D2: `api/` continua fora — o Next copia para a memória o corpo de toda requisição que passa pelo proxy, com corte
// silencioso em 10 MB (proxyClientMaxBodySize.md): o exame de até 20 MB (US-015) chegaria cortado e o lerCorpoLimitado
// das rotas sem login só agiria depois de o Next já ter guardado o corpo. Não aumentar o proxyClientMaxBodySize.
export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
