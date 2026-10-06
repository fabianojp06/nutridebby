import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// P09-04: antes da hidratação, "Registrar" faria um envio nativo do formulário — um GET com o texto do diário (dado de
// saúde) na URL, que vai para o log de acesso e o Referer. No HTML do servidor o botão nasce desabilitado.
// (Os testes do projeto são `.ts`, sem JSX: createElement.)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { DiarioForm } = await import('./diario-form');

describe('DiarioForm antes da hidratação (P09-04)', () => {
  it('"Registrar" desabilitado no HTML do servidor', () => {
    const html = renderToStaticMarkup(createElement(DiarioForm));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Registrar<\/button>/);
  });
});
