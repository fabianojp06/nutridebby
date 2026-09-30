import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
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
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
