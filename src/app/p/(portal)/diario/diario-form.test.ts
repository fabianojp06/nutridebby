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

describe('DiarioForm com a refeição do plano (Plano 16, US-192)', () => {
  it('a refeição já escolhida vai num campo escondido (sem a lista); "Como foi?" com as duas respostas, "Comi outra coisa" marcada quando pedida', () => {
    const html = renderToStaticMarkup(createElement(DiarioForm, { refeicaoDoPlano: { id: 'r1', rotulo: 'Almoço · 12:30' }, resposta: 'outra_coisa' }));
    expect(html).toContain('<input type="hidden" name="refeicaoId" value="r1"/>');
    expect(html).not.toContain('<select');
    expect(html).toContain('Almoço · 12:30');
    expect(html).toContain('<legend');
    // o React escreve `checked` antes de `value` no HTML: a etiqueta inteira de cada rádio, sem depender da ordem
    const radio = (v: string) => html.match(new RegExp(`<input[^>]*value="${v}"[^>]*/>`))?.[0] ?? '';
    expect(radio('outra_coisa')).toContain('checked=""');
    expect(radio('como_no_plano')).toMatch(/^<input[^>]*type="radio"/);
    expect(radio('como_no_plano')).not.toContain('checked');
  });
  it('"Foto da refeição": o campo da foto pede a câmera traseira (RNF-195)', () => {
    expect(renderToStaticMarkup(createElement(DiarioForm, { foto: true }))).toMatch(/<input[^>]*capture="environment"/);
    expect(renderToStaticMarkup(createElement(DiarioForm))).not.toContain('capture=');
  });
});
