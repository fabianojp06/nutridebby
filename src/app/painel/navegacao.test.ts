import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classeDoItem, iniciais, ITEM_EXAMES, ITENS_DO_MENU, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

describe('menu do painel (D20)', () => {
  it('iniciais: duas primeiras palavras, maiúsculas', () => {
    expect(iniciais('débora  lima souza')).toBe('DL');
    expect(iniciais('Consultório')).toBe('C');
  });
  it('seis itens, nesta ordem', () => {
    expect(ITENS_DO_MENU.map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Configurações']);
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
    expect(itensDoMenu({ exames: false }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Configurações']);
    expect(itensDoMenu({ exames: true }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Conteúdos', 'Configurações']);
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 3)).toBe('Exames recebidos (3)');
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 0)).toBe('Exames recebidos');
    expect(itemAtual('/painel/exames-recebidos')).toBe('/painel/exames-recebidos');
    expect(itemAtual('/painel/exames-recebidos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/exames-recebidos');
  });
});
