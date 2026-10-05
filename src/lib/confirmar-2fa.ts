import { isAPIError } from 'better-auth/api';
import { getDb, type Db } from '@/db/client';
import { chaveDoLimite, consumirLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { getAuth } from './auth';

export const MAX_TENTATIVAS_2FA = 5;
export const JANELA_2FA_S = 15 * 60;
/** Um passo do TOTP (30 s) com a janela ±1 do Better Auth: 90 s cobre todos os momentos em que o mesmo código confere. */
export const REPETICAO_2FA_S = 90;

export type Deps2fa = { db?: Db; agora?: Date; verificar?: (codigo: string, headers: Headers) => Promise<boolean> };

/**
 * A verificação é a do próprio Better Auth, com a sessão da usuária: o segredo nunca sai das tabelas de autenticação.
 * Código errado lança o APIError `INVALID_CODE`; quem decide o que é "errado" é `codigoRecusado`, em confirmarCodigo2fa.
 */
async function verificarPeloBetterAuth(codigo: string, headers: Headers): Promise<boolean> {
  await getAuth().api.verifyTOTP({ body: { code: codigo }, headers });
  return true;
}

/**
 * Só o "código errado" do Better Auth (UNAUTHORIZED + INVALID_CODE) vira `invalido`. Qualquer outro erro (banco fora,
 * sessão revogada pela suspensão, 2FA desligado) sobe: não vira "código recusado" no Histórico de acessos de quem chama e
 * chega ao Sentry (o filtro só deixa o nome da classe; revisão da T4). A tentativa já contada fica: o limite é consumido
 * antes de verificar, de propósito.
 */
function codigoRecusado(err: unknown): boolean {
  return isAPIError(err) && err.status === 'UNAUTHORIZED' && (err.body as { code?: unknown } | undefined)?.code === 'INVALID_CODE';
}

/**
 * RN-145 / D13 (Plano 10A): o código do 2FA "no momento de assinar". `auth.api.verifyTOTP` chamado no servidor não passa
 * pelo rate limit HTTP do Better Auth nem conta falhas com sessão ativa (G7 da pesquisa) — por isso o limite próprio:
 * 5 tentativas em 15 min por usuária (chave = HMAC do id, `public_rate_limits`), zerado no acerto, e a recusa do mesmo
 * código já aceito nos últimos 90 s (devolvido por `liberarCodigo2fa` se a ação falhar). O código nunca vai ao log; quem chama registra a recusa no histórico (digitalizada.ts; no Plano 10B, também o envio do PDF assinado).
 * Um erro que não é o "código errado" do Better Auth sobe (codigoRecusado). O endpoint HTTP `/two-factor/verify-totp` com
 * sessão e 2FA ativo é recusado em auth.ts (hooks.before): sem isso, ele seria um oráculo fora deste limite.
 */
const normalizar = (codigo: unknown) => (typeof codigo === 'string' ? codigo.replace(/\s/g, '') : '');
const marcaDoCodigo = (userId: string, codigo: string) => chaveDoLimite('totp-usado', `${userId}:${codigo}`);

export async function confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps: Deps2fa = {}): Promise<'ok' | 'invalido' | 'bloqueado'> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const codigo = normalizar(e.codigo);
  const tentativas = chaveDoLimite('totp-erro', e.userId);
  if (!(await consumirLimite(db, tentativas, MAX_TENTATIVAS_2FA, JANELA_2FA_S, agora))) return 'bloqueado';
  if (!/^\d{6}$/.test(codigo)) return 'invalido';
  let certo: boolean;
  try {
    certo = await (deps.verificar ?? verificarPeloBetterAuth)(codigo, e.headers);
  } catch (err) {
    if (!codigoRecusado(err)) throw err;
    certo = false;
  }
  if (!certo) return 'invalido';
  if (!(await consumirLimite(db, marcaDoCodigo(e.userId, codigo), 1, REPETICAO_2FA_S, agora))) return 'invalido';
  await liberarLimite(db, tentativas);
  return 'ok';
}

/**
 * Code review do PR #19 (I3): a marca anti-repetição é gasta no 'ok' (dois envios simultâneos com o mesmo código: só um
 * passa), mas a AÇÃO pode falhar depois (409 de um envio em curso, 507 da cota, erro de gravação). Quem chama devolve a
 * marca nessa falha — senão o mesmo código certo, reenviado em menos de 90 s, viraria "Código inválido" e contaria para o
 * bloqueio. Não abre repetição: só a ação que NÃO aconteceu devolve; a que confirmou fica com a marca.
 */
export async function liberarCodigo2fa(e: { userId: string; codigo: unknown }, deps: { db?: Db } = {}): Promise<void> {
  const codigo = normalizar(e.codigo);
  if (/^\d{6}$/.test(codigo)) await liberarLimite(deps.db ?? getDb(), marcaDoCodigo(e.userId, codigo));
}
