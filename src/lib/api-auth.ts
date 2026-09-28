import { getDb } from '@/db/client';
import { getTenantStatus } from '@/modules/plataforma/tenant-status';
import { getAuth } from './auth';
import type { SessionData } from './session';
import { evaluateSession, type AppRole } from './session-rules';

export type ApiAuth = { ok: true; data: SessionData } | { ok: false; response: Response };

const recusa = (status: number, erro: string): ApiAuth => ({
  ok: false,
  response: Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } }),
});

/** Route Handlers: mesma regra de requireUser (papel, 12 h, 2FA do admin, RN-15), respondendo 401/403. */
export async function requireApiUser(req: Request, allowed: readonly AppRole[]): Promise<ApiAuth> {
  const data = await getAuth().api.getSession({ headers: req.headers, query: { disableRefresh: true } });
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now: new Date(),
    path: new URL(req.url).pathname,
    tenantStatus: tenantId ? await getTenantStatus(getDb(), tenantId) : null,
  });
  switch (decision) {
    case 'ok':
      return { ok: true, data: data! };
    case 'login':
    case 'expired':
      return recusa(401, 'Sessão expirada. Entre de novo.');
    case 'suspended':
      return recusa(403, 'Conta temporariamente indisponível');
    case 'setup-2fa':
    case 'forbidden':
      return recusa(403, 'Acesso negado');
    default: {
      const nunca: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(nunca)}`);
    }
  }
}
