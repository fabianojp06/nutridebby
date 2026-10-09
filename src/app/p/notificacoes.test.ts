import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PainelDeNotificacoes } from './notificacoes';

const painel = (estado: Parameters<typeof PainelDeNotificacoes>[0]['estado'], recusa: Parameters<typeof PainelDeNotificacoes>[0]['recusa'] = null) =>
  renderToStaticMarkup(createElement(PainelDeNotificacoes, { estado, recusa, aoAtivar: () => {} }));

describe('"Ativar notificações" (US-040, RNF-191): a região do resultado está sempre montada', () => {
  it('antes de agir ("pode"), o botão e a região role="status" vazia e focável já estão na tela', () => {
    const html = painel('pode');
    expect(html).toMatch(/<button[^>]*>Ativar notificações<\/button>/);
    expect(html).toContain('<p tabindex="-1" role="status"></p>');
  });
  it('depois de agir, só o texto muda na mesma região: "ativo" e "negado" sem o botão', () => {
    const ativo = painel('ativo');
    expect(ativo).not.toContain('<button');
    expect(ativo).toContain('<p tabindex="-1" role="status">Notificações ativadas neste aparelho.</p>');
    const negado = painel('negado');
    expect(negado).not.toContain('<button');
    expect(negado).toMatch(/<p tabindex="-1" role="status">Você bloqueou as notificações\./);
  });
  it('"falhou": a mensagem em role="alert", o botão para tentar de novo e a região de status vazia (o texto não aparece duas vezes)', () => {
    const html = painel('falhou');
    expect(html).toMatch(/<button[^>]*>Ativar notificações<\/button>/);
    expect(html).toContain('<p role="alert">Não foi possível ativar as notificações. Tente de novo.</p>');
    expect(html).toContain('<p tabindex="-1" role="status"></p>');
    const recusada = painel('falhou', { mensagem: 'Sessão expirada. Entre de novo.', entrar: '/entrar', escolher: null });
    expect(recusada).toMatch(/<p role="alert">Sessão expirada\. Entre de novo\. <a href="\/entrar"[^>]*>Entrar<\/a><\/p>/);
    expect(recusada).not.toContain('Tente de novo');
  });
});
