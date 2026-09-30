import { describe, expect, it } from 'vitest';
import { safeReturnPath, withReturnPath } from './safe-return';

describe('safeReturnPath', () => {
  it.each([
    ['/admin', '/admin'],
    ['/painel?x=1', '/painel?x=1'],
    ['//evil.com', null],
    ['https://evil.com', null],
    ['/\\evil.com', null],
    ['javascript:alert(1)', null],
    ['', null],
    [null, null],
    // S1: entradas que a normalização do WHATWG transforma em "//evil.com"
    ['/.//evil.com', null],
    ['/a/..//evil.com', null],
    ['/%2e//evil.com', null],
    ['/./\\evil.com', null],
    ['/.//evil.com?x=1', null],
    ['/a/..//evil.com?volta=/painel', null],
    ['/%2e//evil.com?x=1&y=2', null],
    ['/./\\evil.com?x=1', null],
    ['/..//evil.com', null],
    ['/%2e%2e//evil.com', null],
    // normalização benigna continua aceita
    ['/painel/./pacientes?x=1', '/painel/pacientes?x=1'],
    ['/a/../painel', '/painel'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe('withReturnPath', () => {
  it('repassa ?volta seguro (com query) codificado', () => {
    expect(withReturnPath('/entrar/2fa', '/painel?x=1&y=2')).toBe('/entrar/2fa?volta=%2Fpainel%3Fx%3D1%26y%3D2');
  });
  it('descarta ?volta externo ou ausente', () => {
    expect(withReturnPath('/entrar/2fa', '//evil.com')).toBe('/entrar/2fa');
    expect(withReturnPath('/entrar/2fa', null)).toBe('/entrar/2fa');
  });
});
