import { describe, expect, it } from 'vitest';
import { sqlstateDoErro } from './logger';

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
