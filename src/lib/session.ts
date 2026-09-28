import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionCookie } from 'better-auth/cookies';
import { getDb } from '@/db/client';
import { getTenantStatus } from '@/modules/plataforma/tenant-status';
import { getAuth, slideSession, type Auth } from './auth';
import { logger } from './logger';
import { CURRENT_PATH_HEADER, safeReturnPath } from './safe-return';
import { evaluateSession, homeFor, SECURITY_PATH, SUSPENDED_PATH, type AppRole } from './session-rules';

export type SessionData = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export async function requireUser(allowed: readonly AppRole[], path: string): Promise<SessionData> {
  const h = await headers();
  const auth = getAuth();
  // disableRefresh: a inatividade é avaliada com o updatedAt/expiresAt gravados, antes de
  // qualquer renovação (RNF-06); a renovação só acontece depois, em slideSession.
  const data = await auth.api.getSession({ headers: h, query: { disableRefresh: true } });
  const now = new Date();
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path,
    hasSessionCookie: getSessionCookie(h, { cookiePrefix: 'nd' }) !== null,
    // RN-15: 1 leitura por PK; a suspensão vale na próxima requisição, mesmo com sessão aberta
    tenantStatus: tenantId ? await getTenantStatus(getDb(), tenantId) : null,
  });
  // Página pedida (caminho + query, gravada pelo proxy); sem ela, o caminho fixo da página
  const volta = encodeURIComponent(safeReturnPath(h.get(CURRENT_PATH_HEADER)) ?? path);
  switch (decision) {
    case 'ok':
      try {
        // Também em navegação RSC, em que o Better Auth não renova sozinho
        await slideSession(getDb(), data!.session, data!.user.appRole as AppRole, now);
      } catch (err) {
        // A requisição já está autenticada; falhar a renovação não pode derrubar a página
        logger.warn({ err: err instanceof Error ? err.message : String(err), userId: data!.user.id }, 'falha ao renovar a sessão');
      }
      return data!;
    case 'login':
      redirect(`/entrar?volta=${volta}`);
    case 'expired':
      await auth.api.signOut({ headers: h });
      redirect(`/entrar?expirada=1&volta=${volta}`);
    case 'setup-2fa':
      redirect(SECURITY_PATH);
    case 'suspended':
      redirect(SUSPENDED_PATH);
    case 'forbidden':
      redirect(homeFor(data!.user.appRole as AppRole));
    default: {
      const unreachable: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(unreachable)}`);
    }
  }
}
