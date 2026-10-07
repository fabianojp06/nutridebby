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

  it('redige o cabeçalho x-api-key (spec da IA §5.7) nos níveis 0, 1 e 2', () => {
    const stream = makeMemoryStream();
    const logger = createLogger(stream);

    logger.error({
      'x-api-key': 'k0',
      headers: { 'x-api-key': 'k1', 'content-type': 'application/json' },
      req: { headers: { 'x-api-key': 'k2' } },
      erro: { request: { 'x-api-key': 'k3' } },
    });

    expect(stream.lines).toHaveLength(1);
    const parsed = JSON.parse(stream.lines[0]);

    expect(parsed['x-api-key']).toBe('[removido]');
    expect(parsed.headers['x-api-key']).toBe('[removido]');
    expect(parsed.headers['content-type']).toBe('application/json');
    expect(parsed.req.headers['x-api-key']).toBe('[removido]');
    expect(parsed.erro.request['x-api-key']).toBe('[removido]');
    expect(stream.lines[0]).not.toMatch(/"k[0-3]"/);
  });
});
