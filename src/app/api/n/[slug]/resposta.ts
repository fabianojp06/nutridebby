import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIp, clientIpDoLimite } from '@/lib/ip';
import { verifyTurnstile } from '@/lib/turnstile';
import { registrarFalhaTurnstile } from '@/lib/turnstile-log';
import { PublicoError, type DepsPublico } from '@/modules/agenda/agendamento-publico';

/** Página pública (sem sessão): nada destas respostas fica em cache (pedido, código, horários). */
export const SEM_CACHE = { 'cache-control': 'no-store' };
const LIMITE_CORPO = 8 * 1024;

/** JSON de até 8 KB; corpo inválido vira PublicoError (400/413). */
export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  let bruto: Buffer;
  try {
    bruto = await lerCorpoLimitado(req, LIMITE_CORPO);
  } catch (e) {
    if (e instanceof CorpoGrandeError) throw new PublicoError(413, { geral: 'Pedido grande demais.' });
    throw e;
  }
  try {
    const v: unknown = JSON.parse(bruto.toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // cai no 400 abaixo
  }
  throw new PublicoError(400, { geral: 'Pedido inválido.' });
}

/**
 * IP real (TRUSTED_PROXIES: o salto do Traefik não conta; um X-Forwarded-For forjado à esquerda não vence), o balde do
 * limite (IPv6: o /64) e o Turnstile do app.
 */
export function depsDaRequisicao(req: Request): DepsPublico {
  const env = getEnv();
  const ip = clientIp(req.headers, env.TRUSTED_PROXIES);
  return {
    ip,
    ipDoLimite: clientIpDoLimite(req.headers, env.TRUSTED_PROXIES),
    appUrl: env.APP_URL,
    verificarTurnstile: (token) => verifyTurnstile(token, { secret: env.TURNSTILE_SECRET_KEY, ip, hostname: new URL(env.APP_URL).hostname, onFalha: registrarFalhaTurnstile }),
  };
}

/** PublicoError → JSON com o status dele: `{ erro }` quando só há a mensagem geral, senão `{ erros }` por campo. O resto sobe (500). */
export function comoResposta(e: unknown): Response {
  if (e instanceof PublicoError) {
    const erros = e.erros;
    const corpo = Object.keys(erros).length === 1 && erros.geral ? { erro: erros.geral } : { erros };
    return Response.json(corpo, { status: e.status, headers: SEM_CACHE });
  }
  throw e;
}

/** As três rotas: corpo → ação → 200 com o resultado, ou o erro tratado. */
export async function responder(req: Request, acao: (corpo: Record<string, unknown>, deps: DepsPublico) => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await acao(await lerJson(req), depsDaRequisicao(req)), { headers: SEM_CACHE });
  } catch (e) {
    return comoResposta(e);
  }
}
