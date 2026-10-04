import { describe, expect, it } from 'vitest';
import { novoRequestId, requestIdDe } from './request-id';

describe('request_id (RNF-11)', () => {
  it('novo id é um UUID v4 e aceito por requestIdDe', () => {
    const id = novoRequestId();
    expect(requestIdDe(id)).toBe(id);
  });
  it.each([null, undefined, '', 'abc', '<script>', `${novoRequestId()} x`])('recusa %s', (v) => expect(requestIdDe(v)).toBeNull());
  it('lista de valores (cabeçalho repetido): usa o primeiro, se válido', () => {
    const id = novoRequestId();
    expect(requestIdDe([id, 'outro'])).toBe(id);
  });
});
