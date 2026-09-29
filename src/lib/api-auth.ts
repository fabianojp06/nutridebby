import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { getAuth, slideSession } from './auth';
import { logger } from './logger';
import type { SessionData } from './session';
import { evaluateSession, type AppRole } from './session-rules';

/** `tenant`: a linha já lida para o RN-15 (null para admin). */
export type ApiAuth = { ok: true; data: SessionData; tenant: TenantRow | null } | { ok: false; response: Response };

export const recusaApi = (status: number, erro: string): { ok: false; response: Response } => ({
  ok: false,
  response: Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } }),
});

/** Route Handlers: mesma regra de requireUser (papel, 12 h, 2FA do admin, RN-15), respondendo 401/403. */
export async function requireApiUser(req: Request, allowed: readonly AppRole[]): Promise<ApiAuth> {
  const data = await getAuth().api.getSession({ headers: req.headers, query: { disableRefresh: true } });
  const now = new Date();
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const tenant = tenantId ? await buscarTenant(getDb(), tenantId) : null;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path: new URL(req.url).pathname,
    tenantStatus: (tenant?.status as 'ativa' | 'suspensa' | undefined) ?? null,
  });
  switch (decision) {
    case 'ok':
      // T7-R2b: atividade de API também conta para a janela de 12 h da equipe (uploads, Tarefas 8/10)
      try {
        await slideSession(getDb(), data!.session, data!.user.appRole as AppRole, now);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), userId: data!.user.id }, 'falha ao renovar a sessão');
      }
      return { ok: true, data: data!, tenant };
    case 'login':
    case 'expired':
      return recusaApi(401, 'Sessão expirada. Entre de novo.');
    case 'suspended':
      return recusaApi(403, 'Conta temporariamente indisponível');
    case 'setup-2fa':
    case 'forbidden':
      return recusaApi(403, 'Acesso negado');
    default: {
      const nunca: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(nunca)}`);
    }
  }
}
