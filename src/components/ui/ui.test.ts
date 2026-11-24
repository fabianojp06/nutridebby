import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aviso } from './aviso';
import { Botao } from './botao';
import { Cartao } from './cartao';
import { Selo } from './selo';

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
  it('Selo: o neutro de sempre; a variante "alerta" (Plano 25, §7.1) com os tokens de erro, ícone decorativo e o texto (não só cor)', () => {
    expect(renderToStaticMarkup(Selo({ children: 'Arquivado' }))).toBe('<span class="rounded-full bg-linha px-2 py-0.5 text-sm text-texto">Arquivado</span>');
    const alerta = renderToStaticMarkup(Selo({ variante: 'alerta', children: 'Sinal de risco' }));
    expect(alerta).toMatch(/^<span class="[^"]*\bborder border-erro bg-erro-fundo text-erro\b[^"]*"><svg aria-hidden="true"[^>]*>[\s\S]*<\/svg>Sinal de risco<\/span>$/);
    expect(alerta).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i); // nunca cor literal
  });
});
