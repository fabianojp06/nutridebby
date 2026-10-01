import { describe, expect, it } from 'vitest';
import { lerCsv } from './csv';

describe('lerCsv (RFC 4180)', () => {
  it('cabeçalho na 1ª linha; aspas, vírgula e aspas escapadas dentro do campo; CRLF; linha final vazia', () => {
    expect(lerCsv('a,b\r\n1,"x, ""y"""\r\n2,z\r\n')).toEqual([
      { a: '1', b: 'x, "y"' },
      { a: '2', b: 'z' },
    ]);
  });
  it('linha com número errado de campos é erro com o número da linha', () => {
    expect(() => lerCsv('a,b\n1\n')).toThrow('CSV: linha 2 tem 1 campos, esperava 2');
  });
});
