import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CartaoConviteIaNutri, ConviteIaNutri } from './convite-ia-nutri';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
describe('o convite da IA Nutri em Hoje (§7.8, US-171)', () => {
  it('"A IA Nutri está disponível para você." na voz do app (sem falar pela nutricionista), "Ler e decidir" para a tela do consentimento (origem Hoje) e "Agora não", alvos de 44 px', () => {
    const html = renderToStaticMarkup(createElement(CartaoConviteIaNutri, { aoDispensar: () => {} }));
    expect(html).toContain('A IA Nutri está disponível para você.');
    expect(html).toContain('Aviso do app');
    expect(html).not.toMatch(/Sua nutricionista/);
    expect(html).toMatch(/<a[^>]*href="\/p\/plano\/ia\/autorizar\?de=hoje"[^>]*>Ler e decidir<\/a>/);
    expect(html).toMatch(/<button type="button"[^>]*>Agora não<\/button>/);
    for (const alvo of html.match(/<(a|button)[^>]*>/g) ?? []) expect(alvo).toMatch(/\bmin-h-11\b/);
  });

  it('no servidor (e na hidratação) nada: o "Agora não" mora no aparelho', () => {
    expect(renderToStaticMarkup(createElement(ConviteIaNutri, { dono: 'p1' }))).toBe('');
  });
});
