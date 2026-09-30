import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GraficoLinha } from './grafico-linha';

const render = (pontos: { data: string; valor: number }[], titulo = 'Glicemia de jejum') =>
  renderToStaticMarkup(createElement(GraficoLinha, { id: 'glicemia', titulo, unidade: 'mg/dL', casas: 0, pontos }));

describe('GraficoLinha', () => {
  it('SVG acessível: título, dica por ponto (dd/mm/aaaa: valor unidade) e tabela com os dados', () => {
    const html = render([{ data: '2026-09-01', valor: 95 }, { data: '2026-06-01', valor: 110 }]);
    expect(html).toContain('role="img"');
    expect(html).toContain('<title id="glicemia-titulo">Glicemia de jejum (mg/dL)</title>');
    expect(html).toContain('<title>01/06/2026: 110 mg/dL</title>');
    expect(html).toContain('<title>01/09/2026: 95 mg/dL</title>');
    // pontos em ordem cronológica: o de junho vem antes na linha
    expect(html.indexOf('01/06/2026: 110')).toBeLessThan(html.indexOf('01/09/2026: 95'));
    expect(html).toContain('<caption');
    expect((html.match(/<tr>/g) ?? []).length).toBe(3); // cabeçalho + 2 linhas
  });
  it('valores iguais não quebram a escala (sem divisão por zero)', () => {
    const html = render([{ data: '2026-06-01', valor: 100 }, { data: '2026-09-01', valor: 100 }]);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
  it('texto do título é escapado e série vazia não quebra', () => {
    const html = render([{ data: '2026-06-01', valor: 1 }, { data: '2026-07-01', valor: 2 }], '<script>x</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(render([])).toBe('');
  });
});

describe('GraficoLinha: marcas do eixo', () => {
  const rotulosY = (html: string) => [...html.matchAll(/<text x="[\d.]+" y="[\d.]+" text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((t) => !t.includes('/'));
  it('valores iguais: uma única marca no eixo y', () => {
    const html = render([{ data: '2026-06-01', valor: 100 }, { data: '2026-07-01', valor: 100 }, { data: '2026-08-01', valor: 100 }]);
    expect(rotulosY(html)).toEqual(['100']);
  });
  it('faixa estreita com 0 casas (95–96): sem rótulo repetido', () => {
    const r = rotulosY(render([{ data: '2026-06-01', valor: 95 }, { data: '2026-07-01', valor: 96 }]));
    expect(new Set(r).size).toBe(r.length);
  });
  it('sem console.error (chaves duplicadas) e sem data repetida quando as datas coincidem', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = render([{ data: '2026-06-01', valor: 100 }, { data: '2026-06-01', valor: 100 }]);
    render([{ data: '2026-06-01', valor: 95 }, { data: '2026-07-01', valor: 96 }]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((html.match(/text-anchor="middle"[^>]*>01\/06\/2026</g) ?? []).length).toBe(1);
  });
});
