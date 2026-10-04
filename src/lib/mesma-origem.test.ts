import { describe, expect, it } from 'vitest';
import { mesmaOrigem } from './mesma-origem';

const req = (origin?: string) => new Request('http://localhost:3000/api/x', { method: 'POST', headers: origin === undefined ? {} : { origin } });
const APP = 'http://localhost:3000';

describe('mesmaOrigem (S-9)', () => {
  it('sem Origin passa; a própria origem passa; outra, vazia ou "null" é recusada', () => {
    expect(mesmaOrigem(req(), APP)).toBe(true);
    expect(mesmaOrigem(req('http://localhost:3000'), APP)).toBe(true);
    expect(mesmaOrigem(req('https://evil.example'), APP)).toBe(false);
    expect(mesmaOrigem(req(''), APP)).toBe(false); // antes, as rotas do painel deixavam passar (`origem &&`)
    expect(mesmaOrigem(req('null'), APP)).toBe(false);
  });
});
