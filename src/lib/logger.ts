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
] as const;

/** Paths para o `redact` do pino: cada chave nos níveis 0, 1 e 2, mais casos fixos de headers. */
function redactPaths(): string[] {
  const paths = REDACT_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);
  return [...paths, 'req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];
}

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { app: 'nutridebby' },
      redact: {
        paths: redactPaths(),
        censor: '[removido]',
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
