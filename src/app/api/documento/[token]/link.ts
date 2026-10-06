import { getEnv } from '@/env';
import { lerCookie } from '@/lib/ler-cookie';
import { PublicoError } from '@/modules/agenda/agendamento-publico';
import { LinkError, NOME_COOKIE_LINK, SESSAO_LINK_S, type DepsLink } from '@/modules/documentos/link-documento';
import { comoResposta, depsDaRequisicao, SEM_CACHE } from '../../n/[slug]/resposta';

/** RN-158: o IP real, o balde do limite (/64) e o Turnstile da página pública (mesmo `depsDaRequisicao` do agendamento). */
export function depsDoLink(req: Request): DepsLink {
  const d = depsDaRequisicao(req);
  return { ...d, ipDoLimite: d.ipDoLimite ?? null, appUrl: getEnv().APP_URL };
}

/** A sessão curta do link (`nd_doc`), lida do cabeçalho (o cookie só vai às rotas e à página deste token). */
export const sessaoDoCookie = (req: Request): string | undefined => lerCookie(req.headers.get('cookie'), NOME_COOKIE_LINK);

/**
 * Dois cookies (a página e as rotas do mesmo token), nunca em `/`: a sessão de um link não vai a outro caminho.
 * `Secure` só quando o app é servido em https (como o `nd_vinculo`; o E2E local roda em http).
 */
export function cookiesDaSessao(token: string, sessao: string): string[] {
  const seguro = getEnv().APP_URL.startsWith('https://') ? '; Secure' : '';
  return [`/documento/${token}`, `/api/documento/${token}`].map((p) => `${NOME_COOKIE_LINK}=${sessao}; Path=${p}; HttpOnly${seguro}; SameSite=Strict; Max-Age=${SESSAO_LINK_S}`);
}

export const recusaOrigem = () => Response.json({ erro: 'Pedido inválido.' }, { status: 403, headers: SEM_CACHE });

/** LinkError → `{ erro }` com o status dele; corpo inválido (PublicoError do `lerJson`) → 400/413; o resto sobe (500). */
export function comoRespostaDoLink(e: unknown): Response {
  if (e instanceof LinkError) return Response.json({ erro: e.mensagem }, { status: e.status, headers: SEM_CACHE });
  if (e instanceof PublicoError) return comoResposta(e);
  throw e;
}
