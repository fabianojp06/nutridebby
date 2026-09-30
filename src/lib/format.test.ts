import { describe, expect, it } from 'vitest';
import { formatarBytes } from './format';

describe('formatarBytes (RNF-12: vírgula decimal)', () => {
  it('usa a maior unidade e 1 casa', () => {
    expect(formatarBytes(0)).toBe('0 B');
    expect(formatarBytes(1536)).toBe('1,5 KB');
    expect(formatarBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatarBytes(4.3 * 1024 ** 3)).toBe('4,3 GB');
  });
});
