export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'; // INT-06
export const MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.';

export type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel';

/** Por que devolveu 'indisponivel' (para log/monitoramento; nunca inclui token, segredo ou IP). */
export type FalhaTurnstile = { motivo: 'rede' | 'timeout' | 'http' | 'resposta' | 'config'; status?: number; codigos?: string[] };

const CODIGOS_CONFIG = ['missing-input-secret', 'invalid-input-secret'];

/**
 * INT-06: valida o token no servidor antes de qualquer escrita. Fora do ar = 'indisponivel'
 * (o formulário mostra "Tente novamente em alguns minutos" e NÃO segue sem verificação).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: { secret: string; ip?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number; onFalha?: (f: FalhaTurnstile) => void },
): Promise<ResultadoTurnstile> {
  if (!token || token.length > 2048) return 'invalido';
  const corpo = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.ip) corpo.set('remoteip', opts.ip);
  const falha = (f: FalhaTurnstile): 'indisponivel' => {
    try {
      opts.onFalha?.(f);
    } catch {
      // M17: o aviso (log) não pode trocar o 503 "indisponível" por um 500
    }
    return 'indisponivel';
  };
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch (e) {
    return falha({ motivo: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || e.message === 'abortado') ? 'timeout' : 'rede' });
  }
  if (!res.ok) {
    // A Cloudflare responde segredo errado com HTTP 400 e os códigos no corpo: sem lê-los, o log
    // não diz que o problema é a TURNSTILE_SECRET_KEY. Nunca "invalido" aqui: falha fechada.
    const erro = (await res.json().catch(() => null)) as { 'error-codes'?: unknown } | null;
    const codigos = Array.isArray(erro?.['error-codes']) ? erro['error-codes'].filter((c): c is string => typeof c === 'string') : [];
    if (codigos.some((c) => CODIGOS_CONFIG.includes(c))) return falha({ motivo: 'config', status: res.status, codigos });
    return falha(codigos.length ? { motivo: 'http', status: res.status, codigos } : { motivo: 'http', status: res.status });
  }
  const dados = (await res.json().catch(() => null)) as { success?: boolean; 'error-codes'?: string[] } | null;
  if (!dados) return falha({ motivo: 'resposta', status: res.status });
  if (dados.success === true) return 'ok';
  const codigos = dados['error-codes'] ?? [];
  // segredo ausente/errado é erro de configuração nosso, não "robô": falha fechada, mas como indisponível
  if (codigos.some((c) => CODIGOS_CONFIG.includes(c))) return falha({ motivo: 'config', codigos });
  if (codigos.includes('internal-error')) return falha({ motivo: 'http', codigos });
  return 'invalido';
}
