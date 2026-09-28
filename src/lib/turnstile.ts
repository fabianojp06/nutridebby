export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'; // INT-06
export const MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.';

export type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel';

/**
 * INT-06: valida o token no servidor antes de qualquer escrita. Fora do ar = 'indisponivel'
 * (o formulário mostra "Tente novamente em alguns minutos" e NÃO segue sem verificação).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: { secret: string; ip?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ResultadoTurnstile> {
  if (!token || token.length > 2048) return 'invalido';
  const corpo = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.ip) corpo.set('remoteip', opts.ip);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch {
    return 'indisponivel';
  }
  if (!res.ok) return 'indisponivel';
  const dados = (await res.json().catch(() => null)) as { success?: boolean; 'error-codes'?: string[] } | null;
  if (!dados) return 'indisponivel';
  if (dados.success === true) return 'ok';
  return dados['error-codes']?.includes('internal-error') ? 'indisponivel' : 'invalido';
}
