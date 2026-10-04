import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hrefSeguro, lerMarkdown, Markdown } from './markdown';

const html = (texto: string) => renderToStaticMarkup(createElement(Markdown, { texto }));

describe('markdown das orientações (US-052: "sem HTML ou script executável", D7)', () => {
  it('negrito, itálico, títulos, listas, parágrafos e quebra de linha', () => {
    expect(html('## Como ler rótulos\n\nOlhe **sempre** a *porção*.\nDepois os ingredientes.\n\n- açúcar\n- sódio\n\n1. primeiro\n2. segundo')).toBe(
      '<h2>Como ler rótulos</h2><p>Olhe <strong>sempre</strong> a <em>porção</em>.<br/>Depois os ingredientes.</p>' +
        '<ul><li>açúcar</li><li>sódio</li></ul><ol><li>primeiro</li><li>segundo</li></ol>',
    );
    expect(html('# Título 1\n### Título 3\n#### Título 4')).toBe('<h2>Título 1</h2><h3>Título 3</h3><h3>Título 4</h3>');
  });

  it('HTML digitado vira texto (React escapa), nunca elemento', () => {
    const r = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:x">y</a>');
    expect(r).not.toMatch(/<script|<img|<a /);
    expect(r).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('link só http/https, com rel e nova aba; javascript:, data:, // e relativo viram o texto do link', () => {
    expect(html('[Guia](https://www.gov.br/anvisa)')).toBe(
      '<p><a href="https://www.gov.br/anvisa" target="_blank" rel="noopener noreferrer nofollow">Guia</a></p>',
    );
    for (const mau of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', '/p/inicio', 'https://u:p@evil.com']) {
      expect(html(`[clique](${mau})`), mau).toBe('<p>clique</p>');
    }
    expect(hrefSeguro('http://exemplo.com/a?b=1')).toBe('http://exemplo.com/a?b=1');
    // Parênteses balanceados no destino (um nível) fazem parte do link; `[` solto antes do link fica como texto.
    expect(html('[Sódio](https://pt.wikipedia.org/wiki/Sodio_(elemento)) e [[x](https://a.com)')).toBe(
      '<p><a href="https://pt.wikipedia.org/wiki/Sodio_(elemento)" target="_blank" rel="noopener noreferrer nofollow">Sódio</a>' +
        ' e [<a href="https://a.com/" target="_blank" rel="noopener noreferrer nofollow">x</a></p>',
    );
  });

  it('marcação sem fechar fica como texto; nada de retrocesso catastrófico (20000 asteriscos em menos de 200 ms)', () => {
    expect(html('**sem fechar')).toBe('<p>**sem fechar</p>');
    const t0 = performance.now();
    html('*'.repeat(20000));
    html(`[${'['.repeat(10000)}`);
    html('**a'.repeat(6000));
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('texto vazio não gera nada; espaços e linhas em branco a mais não viram parágrafos vazios', () => {
    expect(lerMarkdown('')).toEqual([]);
    expect(html('\n\n  \nA\n\n\n\nB\n')).toBe('<p>A</p><p>B</p>');
  });
});
