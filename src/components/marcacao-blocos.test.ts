import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarcacaoBlocos } from './marcacao-blocos';

// Plano 22 (T9, RN-395, RNF-374, Review Focus 5): a marcação mínima vira componentes (`<p>`, `<ul>`, `<strong>`) — nunca
// HTML. Sem DOM (environment: 'node'): só a estrutura renderizada.
const html = (texto: string, formato?: 'marcacao') => renderToStaticMarkup(createElement(MarcacaoBlocos, { texto, formato }));

describe('MarcacaoBlocos (RN-395)', () => {
  it('parágrafos, lista e negrito em componentes', () => {
    const h = html('Tome **com água**.\n\n- de manhã\n- **à noite**', 'marcacao');
    expect(h).toContain('<p class="whitespace-pre-line">Tome <strong>com água</strong>.</p>');
    expect(h).toMatch(/<ul[^>]*><li>de manhã<\/li><li><strong>à noite<\/strong><\/li><\/ul>/);
  });

  it('"<script>", "<b>", links e "&" saem escapados, como texto', () => {
    const h = html('<script>alert(1)</script> & <b>x</b>\n- <img src=x onerror=alert(1)> [site](https://mal.example)', 'marcacao');
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt; [site](https://mal.example)');
    for (const ativo of ['<script', '<b>', '<img', '<a ', 'href=']) expect(h, ativo).not.toContain(ativo);
  });

  it('sem formato (conteúdo antigo): texto puro com as quebras de linha, os "**" e o hífen como foram escritos', () => {
    expect(html('Tome **com água**.\n- de manhã')).toBe('<p class="whitespace-pre-line">Tome **com água**.\n- de manhã</p>');
  });

  it('guarda de texto: nenhum arquivo do documento no painel, do componente ou do módulo de documentos usa dangerouslySetInnerHTML', () => {
    const arquivos = ['src/app/painel/pacientes/[id]/documentos', 'src/modules/documentos']
      .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts')).map((d) => path.join(d.parentPath, d.name)))
      .concat(path.resolve('src/components/marcacao-blocos.tsx'));
    expect(arquivos.length).toBeGreaterThan(20);
    expect(arquivos.some((f) => f.endsWith('orientacoes-campo.tsx'))).toBe(true); // a guarda alcança o editor das orientações
    expect(arquivos.filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'))).toEqual([]);
  });
});
