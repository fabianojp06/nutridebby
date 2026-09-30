import { describe, expect, it } from 'vitest';
import type pino from 'pino';
import { createLogger } from './logger';

function makeMemoryStream(): pino.DestinationStream & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(msg: string) {
      lines.push(msg);
    },
  };
}

describe('logger redact (RNF-11)', () => {
  it('redige segredos em até dois níveis e preserva campos normais', () => {
    const stream = makeMemoryStream();
    const logger = createLogger(stream);

    // LOG_LEVEL='error' em ambiente de teste (test/setup.ts) — .error() garante que a
    // linha seja escrita independentemente do nível configurado.
    logger.error({
      password: 'a',
      user: { token: 'b', perfil: { accessToken: 'c' } },
      req: { headers: { cookie: 'd', authorization: 'e' } },
      keep: 'ok',
    });

    expect(stream.lines).toHaveLength(1);
    const parsed = JSON.parse(stream.lines[0]);

    expect(parsed.password).toBe('[removido]');
    expect(parsed.user.token).toBe('[removido]');
    expect(parsed.user.perfil.accessToken).toBe('[removido]');
    expect(parsed.req.headers.cookie).toBe('[removido]');
    expect(parsed.req.headers.authorization).toBe('[removido]');
    expect(parsed.keep).toBe('ok');
  });
});
