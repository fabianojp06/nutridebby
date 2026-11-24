import pino from 'pino';

/** Chaves de segredo (RNF-11): nunca devem aparecer em claro nos logs. */
const REDACT_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'secret',
  'url',
  'cookie',
  'authorization',
  // Plano 11 (spec da IA §5.7): defesa extra — a chave do provedor e o conteúdo de ia_tarefas nunca vão para o log
  'apiKey',
  'x-api-key',
  'parametros',
  'resultado',
] as const;

/**
 * Code review do PR #23: "resultado" e "parametros" também são nomes de campos legítimos (o status da notificação em
 * notificacoes/enviar.ts). Nelas, só passa um valor com cara de código (minúsculas, dígitos e _, como "enviada" ou
 * "paciente_inativo"); objeto, lista, número e texto livre — a forma do conteúdo de ia_tarefas — saem como "[removido]".
 */
const SO_CODIGO = new Set<string>(['parametros', 'resultado']);
const CODIGO = /^[a-z][a-z0-9_]{0,39}$/;

function censurar(valor: unknown, caminho: string[]): unknown {
  const chave = caminho[caminho.length - 1];
  return SO_CODIGO.has(chave) && typeof valor === 'string' && CODIGO.test(valor) ? valor : '[removido]';
}

/** Segmento de path do fast-redact: chave com hífen (x-api-key) só vale com colchetes. */
function segmento(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `["${key}"]`;
}

/** Paths para o `redact` do pino: cada chave nos níveis 0, 1 e 2, mais casos fixos de headers. */
export function redactPaths(): string[] {
  const paths = REDACT_KEYS.flatMap((key) => {
    const s = segmento(key);
    return [s.startsWith('.') ? key : s, `*${s}`, `*.*${s}`];
  });
  return [...paths, 'req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];
}

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { app: 'nutridebby' },
      redact: {
        paths: redactPaths(),
        censor: censurar,
      },
    },
    destination,
  );
}

export const logger = createLogger();

/**
 * Só o nome do erro (RNF-11): a mensagem de erros de fila/banco/rede pode citar e-mail,
 * link ou parâmetros da consulta — nunca vai para o log.
 */
export function nomeDoErro(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * O SQLSTATE (5 caracteres) de um erro do Postgres, procurado também no `cause` em que o Drizzle o embrulha — nunca a
 * mensagem, que pode citar SQL e parâmetros (RNF-11, regra 3). Código fora do formato (ECONNREFUSED…) não conta.
 */
export function sqlstateDoErro(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 3 && e !== null && typeof e === 'object'; i++, e = (e as { cause?: unknown }).cause) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}

/**
 * Os campos de log de um erro qualquer (regra 3): o nome e o SQLSTATE, nunca a mensagem nem os campos do erro do pg
 * (`detail`, `where`: o CONTEXT de um jsonb recusado cita o texto). Para quem receberia o erro cru (o `error` do pg-boss).
 */
export function camposDoErro(err: unknown): { erro: string; sqlstate: string | undefined; codigo?: string } {
  const campos: { erro: string; sqlstate: string | undefined; codigo?: string } = { erro: nomeDoErro(err), sqlstate: sqlstateDoErro(err) };
  // código de sistema do Node (ECONNREFUSED, ETIMEDOUT…): fixo, sem dado, e é a causa mais comum do `error` do pg-boss
  const codigo = (err as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string' && /^E[A-Z]{2,30}$/.test(codigo)) campos.codigo = codigo;
  return campos;
}
