import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { camposDoErro, createLogger, sqlstateDoErro } from './logger';

describe('sqlstateDoErro (regra 3: só o código do Postgres, nunca a mensagem)', () => {
  it('lê o SQLSTATE do erro do pg ou do `cause` em que o Drizzle o embrulha; nada fora do formato', () => {
    const pg = Object.assign(new Error('duplicate key value (email)=(x@y.z)'), { code: '23505' });
    expect(sqlstateDoErro(pg)).toBe('23505');
    expect(sqlstateDoErro(Object.assign(new Error('Failed query'), { cause: pg }))).toBe('23505');
    expect(sqlstateDoErro(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeUndefined();
    expect(sqlstateDoErro('texto')).toBeUndefined();
    expect(sqlstateDoErro(null)).toBeUndefined();
  });
});

describe('camposDoErro (SUS-110: o `error` do pg-boss sem o erro cru)', () => {
  it('só o nome e o SQLSTATE: nem a mensagem, nem o DETAIL/CONTEXT do pg chegam à linha do log', () => {
    const pg = Object.assign(new Error('invalid input syntax for type json'), {
      code: '22P02',
      detail: 'Unicode low surrogate must follow a high surrogate.',
      where: 'JSON data, line 1: {"texto":"Refere dor abdominal\\udc00...',
    });
    expect(camposDoErro(pg)).toEqual({ erro: 'Error', sqlstate: '22P02' });
    expect(camposDoErro('texto solto')).toEqual({ erro: 'string', sqlstate: undefined });
    const linhas: string[] = [];
    const log = createLogger(new Writable({ write: (c: Buffer, _e, cb) => (linhas.push(c.toString()), cb()) }));
    log.error(camposDoErro(pg), 'pg-boss erro');
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0])).toMatchObject({ erro: 'Error', sqlstate: '22P02', msg: 'pg-boss erro' });
    expect(linhas[0]).not.toMatch(/dor abdominal|JSON data|surrogate|invalid input/);
  });
});
