import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estadoDoAparelho, PainelDeNotificacoes } from './notificacoes';

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

describe('estadoDoAparelho: a detecção de "negado" ao abrir a tela (TRI-17-20 #47)', () => {
  const aparelho = (permission: NotificationPermission, inscricao: object | null = null) => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (inscricao ? { toJSON: () => inscricao, unsubscribe: async () => true } : null) } }) },
    });
    vi.stubGlobal('window', { PushManager: class {}, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('Notification', { permission });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('denied → "negado"; default → "pode"; granted sem inscrição → "pode"; granted com a inscrição desta conta → "ativo"', async () => {
    aparelho('denied');
    expect(await estadoDoAparelho('chave', 'dono-negado')).toBe('negado');
    aparelho('default');
    expect(await estadoDoAparelho('chave', 'dono-default')).toBe('pode');
    aparelho('granted');
    expect(await estadoDoAparelho('chave', 'dono-sem-inscricao')).toBe('pode');
    aparelho('granted', { endpoint: 'https://push.example.test/x' });
    expect(await estadoDoAparelho('chave', 'dono-com-inscricao')).toBe('ativo');
  });

  it('sem a chave da plataforma, "indisponivel" mesmo com as notificações bloqueadas', async () => {
    aparelho('denied');
    expect(await estadoDoAparelho(null, 'dono-sem-chave')).toBe('indisponivel');
  });
});
