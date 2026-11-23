import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionCookie } from 'better-auth/cookies';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import { lerMembroDaEquipe, type MembroDaEquipe } from '@/modules/plataforma/membro-da-equipe';
import { buscarTenant, statusDe } from '@/modules/plataforma/tenant-status';
import { getAuth, slideSession, type Auth } from './auth';
import { logger, nomeDoErro } from './logger';
import { CURRENT_PATH_HEADER, safeReturnPath } from './safe-return';
import { prazosDaRequisicao } from './sessao-prazos';
import {
  ACESSO_DESATIVADO_PATH,
  caminhoOutroPapel,
  evaluateSession,
  fimDaSessao,
  SECURITY_PATH,
  semPermissaoPath,
  SUSPENDED_PATH,
  type AppRole,
  type PrazosDaEquipe,
} from './session-rules';

export type SessionData = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/**
 * T14 (S-7, nutricionista): uma leitura de sessão + tenant por requisição, dividida entre o layout e a página. Plano 26
 * (RN-504): com a conta `recepcao`, também a linha dela em `equipe_membros` (ativa? Financeiro?), na mesma leitura — a
 * desativação e a permissão valem na próxima requisição.
 */
const lerSessaoDaRequisicao = cache(async () => {
  const h = await headers();
  // disableRefresh: a inatividade é avaliada com o updatedAt/expiresAt gravados, antes de
  // qualquer renovação (RNF-06); a renovação só acontece depois, em slideSession.
  const data = await getAuth().api.getSession({ headers: h, query: { disableRefresh: true } });
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  // RN-15: 1 leitura por PK; a suspensão vale na próxima requisição, mesmo com sessão aberta
  const tenant = tenantId ? await buscarTenant(getDb(), tenantId) : null;
  const membro = await membroDaSessao(data, tenantId);
  return { h, data, tenant, membro, prazos: prazosDaRequisicao(h) };
});

/** Plano 26 (RN-503, RN-504): a linha da recepção em `equipe_membros`; `null` para os outros papéis (e sem consultório). */
async function membroDaSessao(data: SessionData | null, tenantId: string | null | undefined): Promise<MembroDaEquipe | null> {
  if (!data || data.user.appRole !== 'recepcao' || !tenantId) return null;
  return lerMembroDaEquipe(getDb(), tenantId, data.user.id);
}

/**
 * A renovação da sessão, uma vez por requisição. A chave do cache é o próprio objeto da leitura (o mesmo para o layout e
 * a página dentro de um render); recebê-lo em vez de reler a sessão mantém uma leitura só fora de um render (Server
 * Action, Route Handler), onde o cache do React não guarda nada.
 */
const deslizarUmaVez = cache(async (data: SessionData, prazos: PrazosDaEquipe) => {
  try {
    // Também em navegação RSC, em que o Better Auth não renova sozinho
    await slideSession(getDb(), data.session, data.user.appRole as AppRole, new Date(), prazos);
  } catch (err) {
    // A requisição já está autenticada; falhar a renovação não pode derrubar a página.
    // Só o nome do erro (RNF-11, regra 3): a mensagem do erro de banco traz o SQL e os parâmetros (id e token da sessão).
    logger.warn({ erro: nomeDoErro(err), userId: data.user.id }, 'falha ao renovar a sessão');
  }
});

export async function requireUser(allowed: readonly AppRole[], path: string): Promise<SessionData> {
  return (await requireUserComTenant(allowed, path)).data;
}

/**
 * requireUser devolvendo também a linha do tenant já lida para o RN-15 (F8: quem precisa
 * do tenant — requireNutri — não lê `tenants` de novo). `null` para admin. `membro` (Plano 26): a linha da recepção em
 * `equipe_membros`, lida na mesma requisição (`null` para os outros papéis).
 */
export async function requireUserComTenant(
  allowed: readonly AppRole[],
  path: string,
): Promise<{ data: SessionData; tenant: TenantRow | null; membro: MembroDaEquipe | null }> {
  const { h, data, tenant, membro, prazos } = await lerSessaoDaRequisicao();
  const auth = getAuth();
  const now = new Date();
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path,
    hasSessionCookie: getSessionCookie(h, { cookiePrefix: 'nd' }) !== null,
    tenantStatus: statusDe(tenant),
    prazos,
    equipe: membro,
  });
  // Página pedida (caminho + query, gravada pelo proxy); sem ela, o caminho fixo da página
  const volta = encodeURIComponent(safeReturnPath(h.get(CURRENT_PATH_HEADER)) ?? path);
  switch (decision) {
    case 'ok':
      await deslizarUmaVez(data!, prazos);
      return { data: data!, tenant, membro };
    case 'login':
      redirect(`/entrar?volta=${volta}`);
    case 'expired': {
      // P12-14: com a linha ainda lida (sessão aberta antes das regras novas, ou o relógio do banco à frente do
      // expiresAt), /entrar diz o motivo; sem ela (o Better Auth já recusou pelo expiresAt), o aviso genérico
      const motivo = data?.session ? fimDaSessao(data.session, now, prazos) : null;
      await auth.api.signOut({ headers: h });
      redirect(motivo ? `/entrar?motivo=${motivo}&volta=${volta}` : `/entrar?expirada=1&volta=${volta}`);
    }
    case 'setup-2fa':
      redirect(SECURITY_PATH);
    case 'suspended':
      redirect(SUSPENDED_PATH);
    case 'desativada':
      // Plano 26 (RN-503, RE-D45): a conta da recepção desativada não abre nada; a página do aviso tem o "Sair"
      redirect(ACESSO_DESATIVADO_PATH);
    case 'forbidden':
      // Plano 26 (RN-504): a recepção numa tela só da nutricionista (requireNutri) vê "Sem permissão", dentro do painel
      if (data?.user.appRole === 'recepcao' && allowed.includes('nutri')) redirect(semPermissaoPath('nutri'));
      // P09-03: nada de redirect calado para a home do papel — a tela diz com qual conta o aparelho está
      redirect(caminhoOutroPapel(allowed));
    default: {
      const unreachable: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(unreachable)}`);
    }
  }
}
