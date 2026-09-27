export type AppRole = 'admin' | 'nutri' | 'paciente';
export type SessionDecision = 'ok' | 'login' | 'expired' | 'setup-2fa' | 'forbidden';

export const STAFF_IDLE_MS = 12 * 60 * 60 * 1000;
export const SECURITY_PATH = '/conta/seguranca';

export function homeFor(role: AppRole): string {
  return role === 'admin' ? '/admin' : role === 'nutri' ? '/painel' : '/p';
}

export function evaluateSession(input: {
  session: { updatedAt: Date } | null;
  user: { appRole: string; twoFactorEnabled?: boolean | null } | null;
  allowed: readonly AppRole[];
  now: Date;
  path: string;
}): SessionDecision {
  const { session, user, allowed, now, path } = input;
  if (!session || !user) return 'login';
  const role = user.appRole as AppRole;
  if (!allowed.includes(role)) return 'forbidden';
  const staff = role === 'admin' || role === 'nutri';
  if (staff && now.getTime() - new Date(session.updatedAt).getTime() > STAFF_IDLE_MS) return 'expired';
  if (role === 'admin' && !user.twoFactorEnabled && path !== SECURITY_PATH) return 'setup-2fa';
  return 'ok';
}
