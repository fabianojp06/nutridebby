import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem dos formulários de revisão com um estado pedido (o useActionState devolve esse estado; as ações não rodam).
// A troca do rádio no navegador (a caixa aparecendo ao marcar "Outro motivo") fica para o E2E da integração.
const estado = vi.hoisted(() => ({ atual: {} as Record<string, unknown> }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useActionState: () => [estado.atual, () => {}, false] }));
vi.mock('./actions', () => ({ aceitarEnvioAction: vi.fn(), recusarEnvioAction: vi.fn() }));
const { AceitarForm } = await import('./aceitar-form');
const { RecusarForm } = await import('./recusar-form');

const aceitar = (s: Record<string, unknown> = {}) => {
  estado.atual = s;
  return renderToStaticMarkup(createElement(AceitarForm, { id: 'e', tituloInicial: 'Hemograma', dataInicial: '2026-10-01', hoje: '2026-10-07', comIa: false }));
};
const recusar = (s: Record<string, unknown> = {}) => {
  estado.atual = s;
  return renderToStaticMarkup(createElement(RecusarForm, { id: 'e' }));
};
const summary = (html: string) => html.match(/<summary[^>]*>/)?.[0] ?? '';

describe('revisão do envio: "Aceitar" e "Recusar" com o marcador do <details> (revisão da T11)', () => {
  it.each([
    ['Aceitar', aceitar],
    ['Recusar', recusar],
  ])('"%s": o summary não troca o display (sem inline-flex/flex/list-none), então o navegador desenha a seta', (rotulo, montar) => {
    const html = montar();
    expect(html).toContain(`>${rotulo}</summary>`);
    const s = summary(html);
    expect(s).toContain('cursor-pointer');
    expect(s).toContain('min-h-11');
    expect(s).not.toMatch(/\b(inline-flex|flex|grid|block|list-none)\b/);
  });
});

describe('"Recusar": a caixa "Escreva o motivo" só com "Outro motivo" (US-164, revisão da T11)', () => {
  it('formulário novo, nenhum motivo marcado: sem a caixa do texto', () => {
    const html = recusar();
    expect(html).not.toContain('Escreva o motivo');
    expect(html).not.toContain('name="texto"');
    expect(html).toContain('Confirmar recusa');
  });

  it.each(['ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido'])('erro com "%s" marcado: o rádio volta marcado e a caixa não aparece', (m) => {
    const html = recusar({ erros: { geral: 'x' }, valores: { motivo: m, texto: 'Você já enviou' } });
    expect(html).toMatch(new RegExp(`<input[^>]*id="motivo-${m}"[^>]*checked=""`));
    expect(html).not.toContain('name="texto"');
    expect(html).not.toContain('Você já enviou');
  });

  it('erro do texto em "Outro motivo": a caixa aparece logo abaixo da opção, com o texto digitado e o erro ligado a ela', () => {
    const html = recusar({ erros: { texto: 'Escreva o motivo para o paciente' }, valores: { motivo: 'outro', texto: 'abc' } });
    expect(html).toMatch(/<input[^>]*id="motivo-outro"[^>]*checked=""/);
    const iOutro = html.indexOf('id="motivo-outro"');
    const iTexto = html.indexOf('id="recusar-texto"');
    expect(iTexto).toBeGreaterThan(iOutro);
    expect(html.indexOf('Confirmar recusa')).toBeGreaterThan(iTexto);
    const caixa = html.match(/<textarea[^>]*>[^<]*<\/textarea>/)?.[0] ?? '';
    expect(caixa).toContain('name="texto"');
    expect(caixa).toContain('maxLength="300"');
    expect(caixa).toContain('aria-invalid="true"');
    expect(caixa).toContain('aria-describedby="recusar-texto-erro"');
    expect(caixa).toContain('>abc</textarea>');
    expect(html).toMatch(/<p id="recusar-texto-erro" role="alert"[^>]*>Escreva o motivo para o paciente<\/p>/);
  });
});
