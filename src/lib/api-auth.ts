import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import { buscarTenant, statusDe } from '@/modules/plataforma/tenant-status';
import { getAuth, slideSession } from './auth';
import { ehConsultaAutomatica } from './consulta-automatica';
import { logger, nomeDoErro } from './logger';
import { prazosDaRequisicao } from './sessao-prazos';
import type { SessionData } from './session';
import { evaluateSession, MSG_SESSAO_EXPIRADA, type AppRole } from './session-rules';

/**
 * Por que a sessão foi recusada, sem ler a resposta: `sem_sessao` é o 401 (sem sessão ou expirada); `papel`, qualquer 403
 * (papel errado, conta suspensa, 2FA do admin). `requireApiNutri` repassa (o download do CSV responde com redirect).
 */
export type MotivoDaSessaoRecusada = 'sem_sessao' | 'papel';

/** `tenant`: a linha já lida para o RN-15 (null para admin). */
export type ApiAuth =
  | { ok: true; data: SessionData; tenant: TenantRow | null }
  | { ok: false; response: Response; motivo: MotivoDaSessaoRecusada };

/** `extra`: campos além do `erro` (ex.: `motivo: 'escolher'` do portal, S-4) — nunca dado pessoal. */
export const recusaApi = (status: number, erro: string, extra: Record<string, string> = {}): { ok: false; response: Response } => ({
  ok: false,
  response: Response.json({ erro, ...extra }, { status, headers: { 'cache-control': 'no-store' } }),
});

/**
 * Route Handlers: mesma regra de requireUser (papel, 30 min sem uso e 8 h da equipe, 2FA do admin, RN-15), respondendo
 * 401/403. A sessão aceita desliza (a requisição autenticada conta como uso); `data.session` volta com os valores gravados.
 * P12-14 (revisão): consulta automática da tela (cabeçalho `x-nd-consulta: 1`, src/lib/consulta-automatica.ts) e rota que
 * só devolve estado (`renovar: false`) conferem a sessão igual, mas não contam como uso — sem ninguém na tela, o polling
 * não pode manter a sessão aberta até as 8 h.
 */
export async function requireApiUser(req: Request, allowed: readonly AppRole[], { renovar = true }: { renovar?: boolean } = {}): Promise<ApiAuth> {
  return autenticarApi(req, allowed, renovar && !ehConsultaAutomatica(req.headers));
}

/**
 * P12-14: a mesma conferência de requireApiUser, SEM renovar a sessão — só para `GET /api/sessao/ativa`, em que a tela
 * pergunta quanto falta antes de avisar ou de sair (perguntar não pode contar como uso).
 */
export async function lerSessaoApi(req: Request, allowed: readonly AppRole[]): Promise<ApiAuth> {
  return autenticarApi(req, allowed, false);
}

async function autenticarApi(req: Request, allowed: readonly AppRole[], deslizar: boolean): Promise<ApiAuth> {
  const data = await getAuth().api.getSession({ headers: req.headers, query: { disableRefresh: true } });
  const now = new Date();
  const prazos = prazosDaRequisicao(req.headers);
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const tenant = tenantId ? await buscarTenant(getDb(), tenantId) : null;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path: new URL(req.url).pathname,
    tenantStatus: statusDe(tenant),
    prazos,
  });
  switch (decision) {
    case 'ok':
      if (!deslizar) return { ok: true, data: data!, tenant };
      // T7-R2b: atividade de API também conta para a janela da equipe (uploads, Tarefas 8/10; 30 min desde o P12-14)
      try {
        const gravada = await slideSession(getDb(), data!.session, data!.user.appRole as AppRole, now, prazos);
        if (gravada) Object.assign(data!.session, gravada);
      } catch (err) {
        // só o nome do erro (RNF-11), como em session.ts: a mensagem do erro de banco traz o SQL e os parâmetros
        logger.warn({ erro: nomeDoErro(err), userId: data!.user.id }, 'falha ao renovar a sessão');
      }
      return { ok: true, data: data!, tenant };
    case 'login':
    case 'expired':
      return { ...recusaApi(401, MSG_SESSAO_EXPIRADA), motivo: 'sem_sessao' };
    case 'suspended':
      return { ...recusaApi(403, 'Conta temporariamente indisponível'), motivo: 'papel' };
    case 'setup-2fa':
    case 'forbidden':
      return { ...recusaApi(403, 'Acesso negado'), motivo: 'papel' };
    default: {
      const nunca: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(nunca)}`);
    }
  }
}
