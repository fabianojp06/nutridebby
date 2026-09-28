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
