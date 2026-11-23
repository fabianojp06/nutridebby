import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classeDoItem, iniciais, ITEM_DUVIDAS, ITEM_EXAMES, ITENS_DO_MENU, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

describe('menu do painel (D20)', () => {
  it('iniciais: duas primeiras palavras, maiúsculas', () => {
    expect(iniciais('débora  lima souza')).toBe('DL');
    expect(iniciais('Consultório')).toBe('C');
  });
  it('os itens fixos, nesta ordem (Plano 20: "Financeiro" entre "Conteúdos" e "Configurações")', () => {
    expect(ITENS_DO_MENU.map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Financeiro', 'Configurações']);
  });
  it.each([
    ['/painel', '/painel'],
    ['/painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b/exames', '/painel/pacientes'],
    ['/painel/agenda/horarios', '/painel/agenda'],
    ['/painel/whatsapp', '/painel/configuracoes'],
    ['/painel/alimentos/novo', '/painel/configuracoes'],
    ['/painel/planos/modelos', '/painel/configuracoes'],
    ['/painel/anamnese/modelos/novo', '/painel/configuracoes'],
    ['/painel/configuracoes/perfil', '/painel/configuracoes'],
    ['/painel/ajuda', null],
    ['/painel/pacientesx', null],
    ['/painel/financeiro', '/painel/financeiro'],
    ['/painel/financeiro/configuracoes', '/painel/financeiro'],
    ['/painel/financeiro/lancamentos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b', '/painel/financeiro'],
    ['/painel/financeirox', null],
  ])('%s → %s', (caminho, item) => expect(itemAtual(caminho)).toBe(item));
  it('o item ativo se distingue por algo além da cor (WCAG 1.4.1): no escuro a pílula some contra o cartão', () => {
    const ativo = classeDoItem(true).split(/\s+/);
    const outro = classeDoItem(false).split(/\s+/);
    for (const c of ['font-semibold', 'underline', 'decoration-2']) {
      expect(ativo).toContain(c);
      expect(outro).not.toContain(c);
    }
    expect(ativo).toContain('bg-destaque');
    expect(readFileSync('src/app/painel/menu-painel.tsx', 'utf8')).toMatch(/className=\{classeDoItem\(atual === i\.href\)\}/);
  });
  it('Plano 12 (D11): "Exames recebidos" entra depois de "Diários" só quando pedido, com o contador no rótulo; marca as subpáginas', () => {
    expect(itensDoMenu({ exames: false }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Financeiro', 'Configurações']);
    expect(itensDoMenu({ exames: true }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Conteúdos', 'Financeiro', 'Configurações']);
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 3)).toBe('Exames recebidos (3)');
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 0)).toBe('Exames recebidos');
    expect(itemAtual('/painel/exames-recebidos')).toBe('/painel/exames-recebidos');
    expect(itemAtual('/painel/exames-recebidos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/exames-recebidos');
  });
  it('Plano 15 (US-175): "Dúvidas dos pacientes" entra antes de "Conteúdos" só quando pedido, com ou sem "Exames recebidos"; marca as subpáginas', () => {
    expect(itensDoMenu({ exames: false, duvidas: false }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Financeiro', 'Configurações']);
    expect(itensDoMenu({ exames: false, duvidas: true }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Dúvidas dos pacientes', 'Conteúdos', 'Financeiro', 'Configurações']);
    expect(itensDoMenu({ exames: true, duvidas: true }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Dúvidas dos pacientes', 'Conteúdos', 'Financeiro', 'Configurações']);
    expect(rotuloDoItem(ITEM_DUVIDAS.rotulo, 2)).toBe('Dúvidas dos pacientes (2)');
    expect(itemAtual('/painel/duvidas')).toBe('/painel/duvidas');
    expect(itemAtual('/painel/duvidas/123')).toBe('/painel/duvidas');
    expect(itemAtual('/painel/duvidasx')).toBeNull();
  });
  it('Plano 20 (RN-327): "Financeiro" para toda nutricionista, entre "Conteúdos" e "Configurações", em todas as combinações do menu', () => {
    for (const exames of [false, true])
      for (const duvidas of [false, true]) {
        const rotulos = itensDoMenu({ exames, duvidas }).map((i) => i.rotulo);
        expect(rotulos.indexOf('Financeiro'), `${exames}/${duvidas}`).toBe(rotulos.indexOf('Conteúdos') + 1);
        expect(rotulos.at(-1)).toBe('Configurações');
        expect(rotulos.at(-2)).toBe('Financeiro');
      }
    expect(itensDoMenu({ exames: true, duvidas: true })).toHaveLength(9); // R-310: o máximo do menu
  });

  it('Plano 22 (EP-D51): as telas de /painel/exames moram no hub e marcam "Configurações"; "Exames recebidos" continua com o próprio item', () => {
    expect(itemAtual('/painel/exames/catalogo')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/exames/catalogo/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/exames/modelos/novo')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/exames-recebidos')).toBe('/painel/exames-recebidos');
    expect(itemAtual('/painel/exames-recebidos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/exames-recebidos');
  });
  it('Plano 22 (T10b, EP-D51): as telas de /painel/prescricao moram no hub e marcam "Configurações"', () => {
    expect(itemAtual('/painel/prescricao/itens')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/prescricao/itens/novo')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/prescricao/itens/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/prescricao/modelos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/configuracoes');
    expect(itemAtual('/painel/prescricaox')).toBeNull();
  });
});
