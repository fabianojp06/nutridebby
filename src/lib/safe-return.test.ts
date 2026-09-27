import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-return';

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
