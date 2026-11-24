import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Plano 18 (RN-273, D26): a estrutura do menu por linha (sem DOM; Esc, clique fora e o foco ficam no E2E da Tarefa 12a).
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('./actions', () => ({ arquivarDaListaAction: vi.fn(), reativarDaListaAction: vi.fn() }));
// a mensagem do window.confirm vira atributo, para o teste conferir o texto exato
vi.mock('@/components/confirmar-botao', () => ({
  ConfirmarBotao: ({ mensagem, children }: { mensagem: string; children: ReactNode }) => createElement('button', { 'data-mensagem': mensagem }, children),
}));
const { MenuDaLinha } = await import('./menu-da-linha');

const ID = '00000000-0000-4000-8000-0000000000a1';
const CAMPOS = { aba: 'todos', busca: 'ana', etiqueta: '', ordem: 'recentes', local: '' };
const render = (status: 'ativo' | 'arquivado' | 'bloqueado', nome = 'Ana Souza') =>
  renderToStaticMarkup(createElement(MenuDaLinha, { id: ID, nome, status, campos: CAMPOS }));
const itens = (html: string) => [...html.matchAll(/<li>[\s\S]*?<(?:a|button)[^>]*>([^<]*)<\/(?:a|button)>/g)].map((m) => m[1]);

describe('MenuDaLinha (RN-273)', () => {
  it('botão "Ações de {nome}" fechado: aria-expanded="false" e aria-controls no painel escondido', () => {
    const html = render('ativo');
    const botao = html.match(/<button[^>]*aria-label="Ações de Ana Souza"[^>]*>/)?.[0];
    expect(botao).toBeDefined();
    expect(botao).toContain('aria-expanded="false"');
    expect(botao).toContain('type="button"');
    const controla = botao!.match(/aria-controls="([^"]+)"/)![1];
    expect(html).toMatch(new RegExp(`<div[^>]*id="${controla}"[^>]*hidden=""`));
  });

  it('ativo: Abrir ficha, Editar cadastro, Arquivar e Pedir exclusão (LGPD)', () => {
    const html = render('ativo');
    expect(itens(html)).toEqual(['Abrir ficha', 'Editar cadastro', 'Arquivar', 'Pedir exclusão (LGPD)']);
    expect(html).toContain(`href="/painel/pacientes/${ID}"`);
    expect(html).toContain(`href="/painel/pacientes/${ID}/perfil"`);
    expect(html).toContain(`href="/painel/pacientes/${ID}/privacidade#exclusao"`);
    expect(html).toContain(
      'data-mensagem="Arquivar Ana Souza? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser."',
    );
    expect(html).not.toContain('Reativar');
  });

  it('arquivado: Abrir ficha, Editar cadastro, Reativar e Pedir exclusão (LGPD)', () => {
    const html = render('arquivado', 'Joana Silva');
    expect(itens(html)).toEqual(['Abrir ficha', 'Editar cadastro', 'Reativar', 'Pedir exclusão (LGPD)']);
    expect(html).toContain(
      'data-mensagem="Reativar Joana Silva? O paciente volta para os ativos e recupera o acesso ao app. Se ele ainda não entrou no app, reenvie o convite em Perfil."',
    );
    expect(html).toContain('aria-label="Ações de Joana Silva"');
  });

  it('bloqueado: só Abrir ficha, sem formulário', () => {
    const html = render('bloqueado');
    expect(itens(html)).toEqual(['Abrir ficha']);
    expect(html).not.toContain('<form');
  });

  it('o formulário de arquivar leva o id e os filtros da lista em campos ocultos (a URL de volta é montada no servidor)', () => {
    const form = render('ativo').match(/<form[\s\S]*?<\/form>/)![0];
    expect(form).toContain(`<input type="hidden" name="id" value="${ID}"/>`);
    for (const [k, v] of Object.entries(CAMPOS)) expect(form).toContain(`<input type="hidden" name="${k}" value="${v}"/>`);
    expect(form).not.toMatch(/name="(url|redirect|voltar)"/);
  });

  it('os alvos (links e botão) têm 44 px', () => {
    const html = render('arquivado');
    for (const a of html.match(/<a [^>]*>/g)!) expect(a).toContain('min-h-11');
    expect(html.match(/<button[^>]*aria-label="Ações[^>]*>/)![0]).toContain('min-h-11');
  });
});
