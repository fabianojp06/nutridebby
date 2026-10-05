import { getDb, type Db } from '@/db/client';
import { chaveDoLimite, consumirLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { getAuth } from './auth';

export const MAX_TENTATIVAS_2FA = 5;
export const JANELA_2FA_S = 15 * 60;
/** Um passo do TOTP (30 s) com a janela ±1 do Better Auth: 90 s cobre todos os momentos em que o mesmo código confere. */
export const REPETICAO_2FA_S = 90;

export type Deps2fa = { db?: Db; agora?: Date; verificar?: (codigo: string, headers: Headers) => Promise<boolean> };

/** A verificação é a do próprio Better Auth, com a sessão da usuária: o segredo nunca sai das tabelas de autenticação. */
async function verificarPeloBetterAuth(codigo: string, headers: Headers): Promise<boolean> {
  try {
    await getAuth().api.verifyTOTP({ body: { code: codigo }, headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * RN-145 / D13 (Plano 10A): o código do 2FA "no momento de assinar". `auth.api.verifyTOTP` chamado no servidor não passa
 * pelo rate limit HTTP do Better Auth nem conta falhas com sessão ativa (G7 da pesquisa) — por isso o limite próprio:
 * 5 tentativas em 15 min por usuária (chave = HMAC do id, `public_rate_limits`), zerado no acerto, e a recusa do mesmo
 * código já aceito nos últimos 90 s. O código nunca vai ao log; quem chama registra a recusa no histórico (digitalizada.ts; no Plano 10B, também o envio do PDF assinado).
 */
export async function confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps: Deps2fa = {}): Promise<'ok' | 'invalido' | 'bloqueado'> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const codigo = typeof e.codigo === 'string' ? e.codigo.replace(/\s/g, '') : '';
  const tentativas = chaveDoLimite('totp-erro', e.userId);
  if (!(await consumirLimite(db, tentativas, MAX_TENTATIVAS_2FA, JANELA_2FA_S, agora))) return 'bloqueado';
  if (!/^\d{6}$/.test(codigo)) return 'invalido';
  if (!(await (deps.verificar ?? verificarPeloBetterAuth)(codigo, e.headers))) return 'invalido';
  if (!(await consumirLimite(db, chaveDoLimite('totp-usado', `${e.userId}:${codigo}`), 1, REPETICAO_2FA_S, agora))) return 'invalido';
  await liberarLimite(db, tentativas);
  return 'ok';
}
