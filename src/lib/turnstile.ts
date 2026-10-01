export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'; // INT-06
export const MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.';

export type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel';

/** Por que devolveu 'indisponivel' (para log/monitoramento; nunca inclui token, segredo ou IP). */
export type FalhaTurnstile = { motivo: 'rede' | 'timeout' | 'http' | 'resposta' | 'config'; status?: number; codigos?: string[] };

const CODIGOS_CONFIG = ['missing-input-secret', 'invalid-input-secret'];
const CODIGOS_TOKEN = ['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate'];
const LIMITE_CORPO_ERRO = 64 * 1024;

/**
 * INT-06: valida o token no servidor antes de qualquer escrita. Fora do ar = 'indisponivel'
 * (o formulário mostra "Tente novamente em alguns minutos" e NÃO segue sem verificação).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: {
    secret: string;
    ip?: string | null;
    /** hostname do app: o token resolvido em outro domínio é recusado */
    hostname?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    onFalha?: (f: FalhaTurnstile) => void;
  },
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
  // O corpo é lido em qualquer status e sem depender do content-type (a Cloudflare manda segredo
  // errado como HTTP 400); corpo de erro grande demais (página de proxy) é descartado sem ler.
  let dados: { success?: unknown; hostname?: unknown; metadata?: unknown } | null = null;
  if (!res.ok && Number(res.headers.get('content-length') ?? 0) > LIMITE_CORPO_ERRO) {
    await res.body?.cancel().catch(() => undefined);
  } else {
    try {
      dados = await res.json();
    } catch (e) {
      // o tempo também corre durante a leitura do corpo: isso é "timeout", não "http"
      const nome = (e as { name?: unknown } | null)?.name;
      if (nome === 'TimeoutError' || nome === 'AbortError') return falha({ motivo: 'timeout' });
    }
  }
  if (res.ok && dados?.success === true) return hostnameConfere(dados, opts.hostname) ? 'ok' : 'invalido';
  const codigos = codigosDe(dados);
  const comCodigos = (motivo: FalhaTurnstile['motivo']) =>
    falha({ motivo, status: res.status, ...(codigos.length ? { codigos: paraLog(codigos) } : {}) });
  // Classifica pela lista inteira; só o que vai ao log é limitado.
  // segredo ausente/errado é erro de configuração nosso, não "robô": falha fechada, mas como indisponível
  if (codigos.some((c) => CODIGOS_CONFIG.includes(c))) return comCodigos('config');
  // Cloudflare com erro 5xx está fora do ar, mesmo que o corpo traga um código de token
  if (res.status >= 500) return comCodigos('http');
  // token vencido/repetido/inválido é problema do formulário: "Confirme que você não é um robô."
  if (codigos.length && codigos.every((c) => CODIGOS_TOKEN.includes(c))) return 'invalido';
  if (!res.ok) return comCodigos('http');
  if (!dados) return comCodigos('resposta'); // 200 com corpo que não é JSON
  if (codigos.includes('internal-error')) return comCodigos('http');
  return 'invalido'; // 200 sem sucesso: código desconhecido ou nenhum (comportamento original)
}

/**
 * O token vale só para o domínio do app (recomendação da Cloudflare). Chaves de teste devolvem
 * `example.com` e são recusadas em produção pelo env.ts, então não são conferidas.
 */
function hostnameConfere(dados: { hostname?: unknown; metadata?: unknown }, esperado: string | undefined): boolean {
  if (!esperado) return true;
  const meta = dados.metadata as { result_with_testing_key?: unknown } | null | undefined;
  if (meta && typeof meta === 'object' && meta.result_with_testing_key === true) return true;
  return dados.hostname === esperado;
}

/** Códigos do corpo: só strings (corpo malformado não vira exceção, M17). */
function codigosDe(corpo: unknown): string[] {
  const c = corpo && typeof corpo === 'object' ? (corpo as { 'error-codes'?: unknown })['error-codes'] : undefined;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}

/** Códigos vindos de fora vão para o log limitados: no máximo 5, cada um com até 64 caracteres. */
function paraLog(codigos: string[]): string[] {
  return codigos.slice(0, 5).map((c) => c.slice(0, 64));
}
