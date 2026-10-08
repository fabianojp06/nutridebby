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

  it('D3 (Plano 07): "Conteúdos" no lugar de "Compras"; a lista de compras marca a aba "Plano"; continuam 7 abas (R16)', () => {
    expect(ITENS_DO_PORTAL.map((i) => i.rotulo)).toEqual(['Início', 'Plano', 'Diário', 'Conteúdos', 'Evolução', 'Agenda', 'Perfil']);
    expect(itemAtual('/p/conteudos/0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).toBe('/p/conteudos');
    expect(itemAtual('/p/compras')).toBe('/p/plano');
  });

  it('US-146 (Plano 10A): "Documentos" marca a aba "Perfil"; a barra continua com 7 abas (R16)', () => {
    expect(itemAtual('/p/documentos')).toBe('/p/perfil');
    expect(itemAtual('/p/perfil')).toBe('/p/perfil');
    expect(ITENS_DO_PORTAL).toHaveLength(7);
  });

  it('Plano 12 (PM-10, D4): "Meus exames" não é aba — marca "Perfil"; a barra continua com 7 abas (R16)', () => {
    expect(itemAtual('/p/exames')).toBe('/p/perfil');
    expect(ITENS_DO_PORTAL).toHaveLength(7);
  });
});
