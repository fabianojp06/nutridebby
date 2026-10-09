import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnunciarSituacoes, anuncioDasMudancas } from './anunciar-situacoes';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
const e = (id: string, nome: string, situacao: string) => ({ id, nome, situacao });

describe('anúncio da troca de situação dos exames enviados (RNF-10)', () => {
  it('anuncia só o envio cuja situação mudou, com o nome dele', () => {
    const antes = [e('a', 'Hemograma', 'Processando…'), e('b', 'Glicemia', 'Aguardando sua nutricionista')];
    const depois = [e('a', 'Hemograma', 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.'), e('b', 'Glicemia', 'Aguardando sua nutricionista')];
    expect(anuncioDasMudancas(antes, depois)).toBe('Hemograma: O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.');
  });

  it('nada mudou (refresh igual): nada a anunciar', () => {
    const lista = [e('a', 'Hemograma', 'Processando…')];
    expect(anuncioDasMudancas(lista, [...lista])).toBe('');
  });

  it('envio novo ou que saiu da lista não é anunciado (o formulário e o cancelamento já dizem); duas trocas juntas, as duas', () => {
    expect(anuncioDasMudancas([], [e('a', 'Hemograma', 'Processando…')])).toBe('');
    expect(anuncioDasMudancas([e('a', 'Hemograma', 'Processando…')], [])).toBe('');
    const antes = [e('a', 'Hemograma', 'Processando…'), e('b', 'Glicemia', 'Processando…')];
    const depois = [e('a', 'Hemograma', 'Aguardando sua nutricionista'), e('b', 'Glicemia', 'Aguardando sua nutricionista')];
    expect(anuncioDasMudancas(antes, depois)).toBe('Hemograma: Aguardando sua nutricionista. Glicemia: Aguardando sua nutricionista');
  });

  it('a região nasce vazia (região inserida já com texto pode não ser anunciada)', () => {
    const html = renderToStaticMarkup(createElement(AnunciarSituacoes, { envios: [e('a', 'Hemograma', 'Processando…')] }));
    expect(html).toBe('<p role="status" class="sr-only"></p>');
  });
});
