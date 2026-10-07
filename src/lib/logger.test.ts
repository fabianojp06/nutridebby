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

  it('code review do PR #23 (item 3): "resultado"/"parametros" com cara de código (status de notificação) passam; o conteúdo da IA não', () => {
    const stream = makeMemoryStream();
    const logger = createLogger(stream);
    const sugestao = { versao: 1, dataColeta: '2026-09-01', linhas: [{ nome: 'Glicose de jejum', valorTexto: '92' }], descartadas: 0 };

    logger.error({ notificacaoId: 'n1', resultado: 'enviada', job: { resultado: 'ignorada', parametros: 'paciente_inativo' } });
    logger.error({
      resultado: sugestao,
      parametros: { pagina: 1 },
      tarefa: { id: 't1', status: 'pronta', resultado: sugestao, parametros: ['x'] },
      erro: { tarefa: { resultado: 'Glicose de jejum 92 mg/dL' } },
      texto: { resultado: 92 },
    });

    expect(stream.lines).toHaveLength(2);
    const legitimo = JSON.parse(stream.lines[0]);
    expect(legitimo.resultado).toBe('enviada');
    expect(legitimo.job).toEqual({ resultado: 'ignorada', parametros: 'paciente_inativo' });
    const ia = JSON.parse(stream.lines[1]);
    expect(ia.resultado).toBe('[removido]');
    expect(ia.parametros).toBe('[removido]');
    expect(ia.tarefa).toEqual({ id: 't1', status: 'pronta', resultado: '[removido]', parametros: '[removido]' });
    expect(ia.erro.tarefa.resultado).toBe('[removido]');
    expect(ia.texto.resultado).toBe('[removido]');
    expect(stream.lines[1]).not.toContain('Glicose');
  });

  it('os outros segredos continuam removidos mesmo com cara de código', () => {
    const stream = makeMemoryStream();
    createLogger(stream).error({ token: 'abc', user: { password: 'a' }, apiKey: 'chave' });
    const parsed = JSON.parse(stream.lines[0]);
    expect(parsed).toMatchObject({ token: '[removido]', user: { password: '[removido]' }, apiKey: '[removido]' });
  });
});
