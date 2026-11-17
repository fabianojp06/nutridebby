import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialogo, DialogoConfirmar } from './dialogo';

const nada = () => undefined;
/** Um <button type="button"> com o texto dado (e, se pedido, um atributo), em qualquer ordem de atributos. */
const botao = (texto: string, ...atributos: string[]) =>
  new RegExp(`<button(?=[^>]*type="button")${atributos.map((a) => `(?=[^>]*${a})`).join('')}[^>]*>${texto}</button>`);

/** Plano 22 (EP-D42, EP-D54): só a estrutura (sem DOM); foco, Esc e axe ficam no Playwright (T3). */
describe('Dialogo e DialogoConfirmar (src/components/dialogo.tsx)', () => {
  it('é um <dialog> nomeado pelo h2 do título (aria-labelledby) e mostra o conteúdo', () => {
    const html = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'Buscar no catálogo', aoFechar: nada }, createElement('p', null, 'conteúdo')));
    const rotulo = /<dialog[^>]* aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(rotulo).toBeTruthy();
    expect(html).toContain(`<h2 id="${rotulo}"`);
    expect(html).toMatch(/<h2[^>]*>Buscar no catálogo<\/h2>/);
    expect(html).toContain('<p>conteúdo</p>');
  });

  it('sem rodapé, o botão "Fechar" (type="button", alvo de 44 px); com rodape={null}, nenhum; com rodapé, o recebido', () => {
    const padrao = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada }, 'x'));
    expect(padrao).toMatch(botao('Fechar', 'min-h-11'));
    const semNada = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada, rodape: null }, createElement('form', null, createElement('button', null, 'Salvar'))));
    expect(semNada).not.toContain('Fechar');
    expect(semNada).toContain('<form><button>Salvar</button></form>');
    const proprio = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada, rodape: createElement('button', { type: 'button' }, 'Adicionar 3 exames') }, 'x'));
    expect(proprio).toContain('Adicionar 3 exames');
    expect(proprio).not.toContain('Fechar');
  });

  it('descrição opcional ligada por aria-describedby', () => {
    const html = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', descricao: 'Só nomes de exames.', aoFechar: nada }, 'x'));
    const id = /<dialog[^>]* aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<p id="${id}"`);
    expect(html).toMatch(/<p id="[^"]+"[^>]*>Só nomes de exames\.<\/p>/);
    expect(renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada }, 'x'))).not.toContain('aria-describedby');
  });

  it('DialogoConfirmar mostra o texto e os rótulos recebidos ("Remover", "Cancelar"), ligados ao diálogo, sem <form> em volta', () => {
    const html = renderToStaticMarkup(
      createElement(DialogoConfirmar, {
        aberto: true,
        titulo: 'Remover todos',
        texto: 'Remover todas as linhas deste exame? Nada muda até você salvar.',
        confirmar: 'Remover',
        aoConfirmar: nada,
        aoFechar: nada,
        perigo: true,
      }),
    );
    expect(html).toContain('Remover todas as linhas deste exame? Nada muda até você salvar.');
    expect(html).toMatch(botao('Remover', 'min-h-11'));
    expect(html).toMatch(botao('Cancelar', 'min-h-11'));
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Fechar');
    const descr = /<dialog[^>]* aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<p id="${descr}"`);
    // perigo: o foco inicial vai para "Cancelar" (a ação que não apaga)
    expect(html).toMatch(botao('Cancelar', 'data-foco-inicial=""'));
    expect(html).not.toMatch(botao('Remover', 'data-foco-inicial'));
  });

  it('DialogoConfirmar: "Cancelar" pode ser trocado; sem perigo, o foco inicial vai para a confirmação', () => {
    const html = renderToStaticMarkup(
      createElement(DialogoConfirmar, { aberto: true, titulo: 'Mostrar no app do paciente', texto: 'x', confirmar: 'Mostrar no app', cancelar: 'Voltar', aoConfirmar: nada, aoFechar: nada }),
    );
    expect(html).toMatch(botao('Voltar'));
    expect(html).not.toContain('Cancelar');
    expect(html).toMatch(botao('Mostrar no app', 'data-foco-inicial=""'));
  });
});
