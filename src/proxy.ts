import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
