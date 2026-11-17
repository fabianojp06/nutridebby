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

  it('children só com aberto (nada oculto no DOM fechado); título e rodapé ficam', () => {
    const fechado = renderToStaticMarkup(createElement(Dialogo, { aberto: false, titulo: 'Buscar', aoFechar: nada }, createElement('ul', null, createElement('li', null, 'Ferritina'))));
    expect(fechado).not.toContain('Ferritina');
    expect(fechado).not.toContain('<ul');
    expect(fechado).toMatch(/<h2[^>]*>Buscar<\/h2>/);
    expect(fechado).toMatch(botao('Fechar'));
    expect(renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'Buscar', aoFechar: nada }, createElement('ul', null, createElement('li', null, 'Ferritina'))))).toContain('<li>Ferritina</li>');
  });

  it('rodapé fora da rolagem: open:flex open:flex-col no <dialog> (nunca flex puro), só o corpo rola, rodapé shrink-0', () => {
    const html = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada }, createElement('p', null, 'corpo')));
    const classe = /<dialog[^>]* class="([^"]+)"/.exec(html)?.[1] ?? '';
    const classes = classe.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['open:flex', 'open:flex-col', 'overflow-hidden']));
    expect(classes).not.toContain('flex');
    expect(classes).not.toContain('overflow-y-auto');
    expect(html).toMatch(/<div class="[^"]*\boverflow-y-auto\b[^"]*\bmin-h-0\b|<div class="[^"]*\bmin-h-0\b[^"]*\boverflow-y-auto\b/);
    expect(html).toMatch(/<div class="[^"]*overflow-y-auto[^"]*"><p>corpo<\/p><\/div>/);
    expect(html).toMatch(/<div class="[^"]*\bshrink-0\b[^"]*"><button[^>]*>Fechar<\/button><\/div><\/dialog>/);
  });

  it('ocupado: "Fechar" fica aria-disabled (sem disabled, o foco não sai) e o diálogo, aria-busy', () => {
    const html = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada, ocupado: true }, 'x'));
    expect(html).toMatch(botao('Fechar', 'aria-disabled="true"'));
    expect(html).not.toContain(' disabled=""');
    expect(html).toMatch(/<dialog[^>]* aria-busy="true"/);
    const livre = renderToStaticMarkup(createElement(Dialogo, { aberto: true, titulo: 'T', aoFechar: nada }, 'x'));
    expect(livre).not.toContain('aria-disabled="');
    expect(livre).not.toContain('aria-busy');
  });

  it('DialogoConfirmar: perigo → role="alertdialog"; sem perigo, sem role (o papel do <dialog>)', () => {
    const base = { aberto: true, titulo: 'T', texto: 'x', confirmar: 'Remover', aoConfirmar: nada, aoFechar: nada };
    expect(renderToStaticMarkup(createElement(DialogoConfirmar, { ...base, perigo: true }))).toMatch(/<dialog[^>]* role="alertdialog"/);
    expect(renderToStaticMarkup(createElement(DialogoConfirmar, base))).not.toContain('role=');
  });

  it('DialogoConfirmar ocupado: os dois botões aria-disabled e o clique não chama nada; livre, "Cancelar" chama aoFechar sem argumentos', () => {
    const chamadas: unknown[][] = [];
    const registra = (...a: unknown[]) => {
      chamadas.push(a);
    };
    const html = renderToStaticMarkup(createElement(DialogoConfirmar, { aberto: true, titulo: 'T', texto: 'x', confirmar: 'Remover', aoConfirmar: nada, aoFechar: nada, perigo: true, ocupado: true }));
    expect(html).toMatch(botao('Cancelar', 'aria-disabled="true"'));
    expect(html).toMatch(botao('Remover', 'aria-disabled="true"'));
    // os onClick, pelos props do rodapé (sem DOM)
    const rodape = (props: Record<string, unknown>) => {
      const el = DialogoConfirmar(props as Parameters<typeof DialogoConfirmar>[0]) as { props: { rodape: { props: { children: { props: { onClick: (e?: unknown) => void } }[] } } } };
      return el.props.rodape.props.children.map((b) => b.props.onClick);
    };
    const [cancelarOcupado, confirmarOcupado] = rodape({ aberto: true, titulo: 'T', texto: 'x', confirmar: 'Remover', aoConfirmar: registra, aoFechar: registra, ocupado: true });
    cancelarOcupado({ type: 'click' });
    confirmarOcupado({ type: 'click' });
    expect(chamadas).toEqual([]);
    const [cancelar, confirmar] = rodape({ aberto: true, titulo: 'T', texto: 'x', confirmar: 'Remover', aoConfirmar: registra, aoFechar: registra });
    cancelar({ type: 'click' });
    confirmar({ type: 'click' });
    expect(chamadas).toEqual([[], []]);
  });
});
