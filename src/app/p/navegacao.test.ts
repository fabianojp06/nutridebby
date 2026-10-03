import { describe, expect, it } from 'vitest';
import { ITENS_DO_PORTAL, itemAtual } from './navegacao';

describe('navegação do portal (D23)', () => {
  it('todo item fica dentro do escopo /p/ do PWA e marca a página atual, também nas subpáginas', () => {
    for (const i of ITENS_DO_PORTAL) expect(i.href.startsWith('/p/')).toBe(true);
    expect(itemAtual('/p/inicio')).toBe('/p/inicio');
    expect(itemAtual('/p/inicio/detalhe')).toBe('/p/inicio');
    expect(itemAtual('/p/iniciozinho')).toBeNull();
    expect(itemAtual('/p/outra')).toBeNull();
  });
});
