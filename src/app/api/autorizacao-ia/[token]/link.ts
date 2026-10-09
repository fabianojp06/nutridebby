import { getEnv } from '@/env';
import { PublicoError } from '@/modules/agenda/agendamento-publico';
import { LinkIaError, type DepsLinkIa } from '@/modules/ia/autorizacao-link';
import { configIA } from '@/modules/ia/modo';
import { comoResposta, depsDaRequisicao, SEM_CACHE } from '../../n/[slug]/resposta';

/** US-107: o IP real, o balde do limite (/64), o Turnstile da página pública, o user-agent (prova de autoria, RN-107) e a IA. */
export function depsDoLinkIa(req: Request): DepsLinkIa {
  const d = depsDaRequisicao(req);
  const env = getEnv();
  return { ...d, ipDoLimite: d.ipDoLimite ?? null, userAgent: req.headers.get('user-agent'), appUrl: env.APP_URL, ia: configIA(env) };
}

export const recusaOrigem = () => Response.json({ erro: 'Pedido inválido.' }, { status: 403, headers: SEM_CACHE });

/** LinkIaError → `{ erro }` com o status dele; corpo inválido (PublicoError do `lerJson`) → 400/413; o resto sobe (500). */
export function comoRespostaDoLinkIa(e: unknown): Response {
  if (e instanceof LinkIaError) return Response.json({ erro: e.mensagem }, { status: e.status, headers: SEM_CACHE });
  if (e instanceof PublicoError) return comoResposta(e);
  throw e;
}
