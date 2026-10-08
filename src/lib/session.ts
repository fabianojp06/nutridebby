import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionCookie } from 'better-auth/cookies';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import { buscarTenant, statusDe } from '@/modules/plataforma/tenant-status';
import { getAuth, slideSession, type Auth } from './auth';
import { logger, nomeDoErro } from './logger';
import { CURRENT_PATH_HEADER, safeReturnPath } from './safe-return';
import { prazosDaRequisicao } from './sessao-prazos';
import { caminhoOutroPapel, evaluateSession, fimDaSessao, SECURITY_PATH, SUSPENDED_PATH, type AppRole, type PrazosDaEquipe } from './session-rules';

export type SessionData = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/** T14 (S-7, nutricionista): uma leitura de sessão + tenant por requisição, dividida entre o layout e a página. */
const lerSessaoDaRequisicao = cache(async () => {
  const h = await headers();
  // disableRefresh: a inatividade é avaliada com o updatedAt/expiresAt gravados, antes de
  // qualquer renovação (RNF-06); a renovação só acontece depois, em slideSession.
  const data = await getAuth().api.getSession({ headers: h, query: { disableRefresh: true } });
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  // RN-15: 1 leitura por PK; a suspensão vale na próxima requisição, mesmo com sessão aberta
  const tenant = tenantId ? await buscarTenant(getDb(), tenantId) : null;
  return { h, data, tenant, prazos: prazosDaRequisicao(h) };
});

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
 * do tenant — requireNutri — não lê `tenants` de novo). `null` para admin.
 */
export async function requireUserComTenant(
  allowed: readonly AppRole[],
  path: string,
): Promise<{ data: SessionData; tenant: TenantRow | null }> {
  const { h, data, tenant, prazos } = await lerSessaoDaRequisicao();
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
  });
  // Página pedida (caminho + query, gravada pelo proxy); sem ela, o caminho fixo da página
  const volta = encodeURIComponent(safeReturnPath(h.get(CURRENT_PATH_HEADER)) ?? path);
  switch (decision) {
    case 'ok':
      await deslizarUmaVez(data!, prazos);
      return { data: data!, tenant };
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
    case 'forbidden':
      // P09-03: nada de redirect calado para a home do papel — a tela diz com qual conta o aparelho está
      redirect(caminhoOutroPapel(allowed));
    default: {
      const unreachable: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(unreachable)}`);
    }
  }
}
