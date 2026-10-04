import { describe, expect, it } from 'vitest';
import { iniciais, ITENS_DO_MENU, itemAtual } from './navegacao';

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
});
