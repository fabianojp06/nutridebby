import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem do formulário (a action não roda): a ajuda fixa do suplemento e do lembrete livre (TRI-17-20 #62).
vi.mock('./actions', () => ({ salvarLembreteAction: vi.fn() }));
const { FormLembrete } = await import('./form-lembrete');

const AJUDA_LIVRE = 'O lembrete não substitui a prescrição nem as orientações registradas no prontuário.';
const AJUDA_SUPLEMENTO = 'O lembrete não substitui a prescrição: composição, via e posologia vão na receita e no prontuário.';

const montar = (tipo: 'suplemento' | 'livre') =>
  renderToStaticMarkup(
    createElement(FormLembrete, { patientId: 'p', inicial: { tipo, texto: '', config: { horarios: ['08:00'], dias: [1] } }, nome: 'lembrete', aoSalvar: () => {} }),
  );
const campoDoTexto = (html: string) => html.match(/<input[^>]*name="texto"[^>]*>/)?.[0] ?? '';
const descritoPor = (html: string) => (campoDoTexto(html).match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ');
const paragrafo = (html: string, id: string) => html.match(new RegExp(`<p id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)</p>`))?.[1];

describe('FormLembrete: ajuda fixa ligada ao campo de texto (NORMAS-F2, TRI-17-20 #62)', () => {
  it('lembrete livre: a ajuda própria aparece e o aria-describedby do texto aponta para ela', () => {
    const html = montar('livre');
    const ajuda = descritoPor(html).find((id) => id.endsWith('-ajuda'));
    expect(ajuda).toBeDefined();
    expect(paragrafo(html, ajuda!)).toBe(AJUDA_LIVRE);
    expect(html).not.toContain(AJUDA_SUPLEMENTO);
  });

  it('suplemento: continua com a ajuda do suplemento, ligada ao campo', () => {
    const html = montar('suplemento');
    const ajuda = descritoPor(html).find((id) => id.endsWith('-ajuda'));
    expect(ajuda).toBeDefined();
    expect(paragrafo(html, ajuda!)).toBe(AJUDA_SUPLEMENTO);
    expect(html).not.toContain(AJUDA_LIVRE);
  });
});
