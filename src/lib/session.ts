import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionCookie } from 'better-auth/cookies';
import { getDb } from '@/db/client';
import { getAuth, slideSession, type Auth } from './auth';
import { evaluateSession, homeFor, SECURITY_PATH, type AppRole } from './session-rules';

export type SessionData = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export async function requireUser(allowed: readonly AppRole[], path: string): Promise<SessionData> {
  const h = await headers();
  const auth = getAuth();
  // disableRefresh: a inatividade é avaliada com o updatedAt/expiresAt gravados, antes de
  // qualquer renovação (RNF-06); a renovação só acontece depois, em slideSession.
  const data = await auth.api.getSession({ headers: h, query: { disableRefresh: true } });
  const now = new Date();
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path,
    hasSessionCookie: getSessionCookie(h, { cookiePrefix: 'nd' }) !== null,
  });
  switch (decision) {
    case 'ok':
      // Também em navegação RSC, em que o Better Auth não renova sozinho
      await slideSession(getDb(), data!.session, data!.user.appRole as AppRole, now);
      return data!;
    case 'login':
      redirect(`/entrar?volta=${encodeURIComponent(path)}`);
    case 'expired':
      await auth.api.signOut({ headers: h });
      redirect('/entrar?expirada=1');
    case 'setup-2fa':
      redirect(SECURITY_PATH);
    case 'forbidden':
      redirect(homeFor(data!.user.appRole as AppRole));
    default: {
      const unreachable: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(unreachable)}`);
    }
  }
}
