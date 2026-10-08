import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { arquivosValidos, EnvioForm } = await import('./envio-form');
const MB = 1024 * 1024;
const arq = (size: number, type: string) => ({ size, type });

describe('EnvioForm (US-160)', () => {
  it('P09-04: "Enviar" nasce desabilitado no HTML do servidor (sem envio nativo com a observação na URL)', () => {
    const html = renderToStaticMarkup(createElement(EnvioForm, { hoje: '2026-10-07' }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enviar<\/button>/);
    expect(html).toContain('max="2026-10-07"');
    expect(html).toContain('Ex.: exame pedido na consulta de setembro.');
    expect(html).toMatch(/<form[^>]*method="post"/);
  });

  it('confere no navegador o que dá sem abrir o arquivo (o servidor confere de novo pelo conteúdo)', () => {
    expect(arquivosValidos([arq(3 * MB, 'application/pdf')])).toBe(true);
    expect(arquivosValidos([arq(25 * MB, 'application/pdf')])).toBe(false);
    expect(arquivosValidos([arq(1 * MB, 'application/pdf'), arq(1 * MB, 'image/jpeg')])).toBe(false);
    expect(arquivosValidos(Array.from({ length: 5 }, () => arq(6 * MB, 'image/heic')))).toBe(true); // 30 MB exatos
    expect(arquivosValidos(Array.from({ length: 4 }, () => arq(9 * MB, 'image/jpeg')))).toBe(false); // 36 MB
    expect(arquivosValidos(Array.from({ length: 6 }, () => arq(1 * MB, 'image/jpeg')))).toBe(false);
    expect(arquivosValidos([arq(15 * MB, 'image/jpeg')])).toBe(false);
    expect(arquivosValidos([])).toBe(false);
  });
});
