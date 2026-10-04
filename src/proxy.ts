import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
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
  // /api/* não passa por aqui (matcher): o id das APIs nasce no onRequestError (Tarefa 2)
  const current = currentPath(req);
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', current); // /entrar valida com safeReturnPath
    return NextResponse.redirect(url);
  }
  // Repassa o caminho atual para requireUser (sessão expirada → /entrar mantendo o ?volta)
  const headers = new Headers(req.headers);
  headers.set(CURRENT_PATH_HEADER, current);
  headers.set(CABECALHO_REQUEST_ID, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(CABECALHO_REQUEST_ID, requestId);
  return res;
}

// D2: `api/` continua fora — o Next copia para a memória o corpo de toda requisição que passa pelo proxy, com corte
// silencioso em 10 MB (proxyClientMaxBodySize.md): o exame de até 20 MB (US-015) chegaria cortado e o lerCorpoLimitado
// das rotas sem login só agiria depois de o Next já ter guardado o corpo. Não aumentar o proxyClientMaxBodySize.
export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
