export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'; // INT-06
export const MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.';

export type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel';

/** Por que devolveu 'indisponivel' (para log/monitoramento; nunca inclui token, segredo ou IP). */
export type FalhaTurnstile = { motivo: 'rede' | 'timeout' | 'http' | 'resposta' | 'config'; status?: number; codigos?: string[] };

const CODIGOS_CONFIG = ['missing-input-secret', 'invalid-input-secret'];
const CODIGOS_TOKEN = ['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate'];

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
  // Um único caminho para o corpo, em 200 ou em HTTP de erro: a Cloudflare responde segredo errado
  // com HTTP 400 e os códigos no corpo. Corpo de erro só é lido se for JSON (página de proxy, não).
  const ehJson = res.ok || (res.headers.get('content-type') ?? '').includes('json');
  const dados = ehJson ? ((await res.json().catch(() => null)) as { success?: unknown } | null) : null;
  if (res.ok && dados?.success === true) return 'ok';
  const codigos = lerCodigos(dados);
  // segredo ausente/errado é erro de configuração nosso, não "robô": falha fechada, mas como indisponível
  if (codigos.some((c) => CODIGOS_CONFIG.includes(c))) return falha({ motivo: 'config', status: res.status, codigos });
  if (!res.ok) {
    // token vencido/repetido/inválido é problema do formulário, não da Cloudflare, mesmo vindo como erro HTTP
    if (codigos.length && codigos.every((c) => CODIGOS_TOKEN.includes(c))) return 'invalido';
    return falha(codigos.length ? { motivo: 'http', status: res.status, codigos } : { motivo: 'http', status: res.status });
  }
  if (!dados) return falha({ motivo: 'resposta', status: res.status });
  if (codigos.includes('internal-error')) return falha({ motivo: 'http', codigos });
  return 'invalido';
}

/** Códigos vindos de fora vão para o log: só strings, no máximo 5, cada uma com até 64 caracteres. */
function lerCodigos(corpo: unknown): string[] {
  const c = corpo && typeof corpo === 'object' ? (corpo as { 'error-codes'?: unknown })['error-codes'] : undefined;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 64)) : [];
}
