import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aviso } from './aviso';
import { Botao } from './botao';
import { Cartao } from './cartao';

describe('componentes base (D24)', () => {
  it('Aviso de erro é role="alert"; de aviso, "status"; o papel pode ser forçado', () => {
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'erro' }, 'x'))).toContain('role="alert"');
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'aviso' }, 'x'))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'aviso', papel: 'alert' }, 'x'))).toContain('role="alert"');
  });
  it('Cartao é uma seção nomeada pelo h2', () => {
    const html = renderToStaticMarkup(createElement(Cartao, { id: 'hoje', titulo: 'Hoje' }, 'x'));
    expect(html).toMatch(/<section aria-labelledby="hoje"[^>]*>.*<h2 id="hoje"[^>]*>Hoje<\/h2>/);
  });
  it('Cartao de destaque marca o contêiner para o foco branco (data-sobre-marca, T12); o comum não', () => {
    expect(renderToStaticMarkup(createElement(Cartao, { id: 'a', titulo: 'A', destaque: true }, 'x'))).toMatch(/<section[^>]* data-sobre-marca=""[^>]*class="[^"]*bg-destaque/);
    expect(renderToStaticMarkup(createElement(Cartao, { id: 'b', titulo: 'B' }, 'x'))).not.toContain('data-sobre-marca');
  });
  it('Botao tem alvo de 44 px (min-h-11)', () => {
    expect(renderToStaticMarkup(createElement(Botao, { type: 'button' }, 'Salvar'))).toContain('min-h-11');
  });
});
