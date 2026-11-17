import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { LinhasDoExame, linhaVazia, type LinhaDoForm } from './linhas-do-exame';

/**
 * Plano 22 (T4, spec §7 "Linhas do lançamento"): só a estrutura (sem DOM; o Vitest roda em `environment: 'node'`). O
 * comportamento no navegador (diálogos, foco, "Usar a a b" preenchendo os campos) fica no Playwright (EP-D54).
 */
const L = MSG_EXAMES.lancamento;
const linha = (o: Partial<LinhaDoForm>, chave = 0): LinhaDoForm => ({ ...linhaVazia(chave), ...o });
const montar = (linhas: LinhaDoForm[], erros: Record<string, string> = {}) =>
  renderToStaticMarkup(createElement(LinhasDoExame, { idBase: 'novo', linhas, aoMudar: () => {}, erros, catalogo: [], modelos: [] }));
/** A tag de abertura do controle com o id pedido. */
const tag = (html: string, id: string) => html.match(new RegExp(`<(?:input|button)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
const descritoPor = (html: string, id: string) => (tag(html, id).match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean);

describe('LinhasDoExame — estrutura (sem DOM)', () => {
  it('cada linha é um grupo com aria-label "Linha {n}: {marcador}" e rótulos numerados por campo', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105' }, 0), linha({ nome: 'Ferritina' }, 1)]);
    expect(html).toContain(`role="group" aria-label="${L.grupoLinha(1, 'Glicemia de jejum')}"`);
    expect(html).toContain(`role="group" aria-label="${L.grupoLinha(2, 'Ferritina')}"`);
    for (const n of [1, 2]) {
      for (const rotulo of [L.marcador(n), L.valor(n), L.unidade(n), L.referencia(n), L.faixaDe(n), L.faixaAte(n)]) {
        expect(html, rotulo).toMatch(new RegExp(`<label for="[^"]+"[^>]*>${rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</label>`));
      }
    }
    expect(html).toContain(`aria-label="Remover a linha 1"`);
  });

  it('o aviso fixo vem uma vez, antes das linhas, com o id citado no aria-describedby do valor; a ajuda da faixa no "de" e no "até"', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105', refMin: '70', refMax: '99' }, 0), linha({ nome: 'Ferritina' }, 1)]);
    const aviso = MSG_EXAMES.classificacao.aviso;
    expect(html.split(aviso)).toHaveLength(2);
    const idAviso = html.match(new RegExp(`<p id="([^"]+)"[^>]*>${aviso.replace(/\./g, '\\.')}</p>`))?.[1];
    expect(idAviso).toBeTruthy();
    expect(html.indexOf(aviso)).toBeLessThan(html.indexOf('role="group"'));
    expect(descritoPor(html, 'novo-valor-0')).toContain(idAviso);
    expect(descritoPor(html, 'novo-valor-1')).toContain(idAviso);
    const idAjuda = html.match(new RegExp(`<p id="([^"]+)"[^>]*>${L.ajudaFaixa}</p>`))?.[1];
    expect(idAjuda).toBeTruthy();
    expect(descritoPor(html, 'novo-refMin-0')).toContain(idAjuda);
    expect(descritoPor(html, 'novo-refMax-0')).toContain(idAjuda);
  });

  it('classificação ao vivo: texto ligado ao valor por aria-describedby, nunca região viva', () => {
    const html = montar([linha({ nome: 'Glicemia de jejum', valor: '105', refMin: '70', refMax: '99' })]);
    const classe = html.match(/<p id="(novo-classe-0)"([^>]*)>([^<]*)<\/p>/);
    expect(classe?.[3]).toBe(MSG_EXAMES.classificacao.acima);
    expect(classe?.[2]).not.toMatch(/role=|aria-live/);
    expect(descritoPor(html, 'novo-valor-0')).toContain('novo-classe-0');
    expect(montar([linha({ nome: 'G', valor: '70', refMin: '70', refMax: '99' })])).toContain(MSG_EXAMES.classificacao.dentro);
    expect(montar([linha({ nome: 'G', valor: '', refMin: '70', refMax: '99' })])).not.toMatch(/Abaixo da referência|Dentro da referência|Acima da referência/);
  });

  it('"Usar 70 a 99 (linha 1)" só com referência de padrão único e a faixa vazia', () => {
    const com = montar([linha({ nome: 'Glicemia de jejum', referencia: '70 a 99 mg/dL' })]);
    expect(com).toContain(`aria-label="${L.usarFaixaRotulo('70', '99', 1)}"`);
    expect(com).toContain(`>${L.usarFaixa('70', '99')}</button>`);
    expect(montar([linha({ nome: 'Colesterol', referencia: 'Desejável < 200; Limítrofe 200 a 239' })])).not.toContain('Usar ');
    expect(montar([linha({ nome: 'G', referencia: '70 a 99', refMin: '70', refMax: '99' })])).not.toContain('Usar ');
    expect(montar([linha({ nome: 'G', referencia: '4,5 - 6,0' })])).toContain(`aria-label="${L.usarFaixaRotulo('4,5', '6', 1)}"`);
  });

  it('faixa e texto diferentes: o aviso sem bloquear, ligado aos campos da faixa', () => {
    const html = montar([linha({ nome: 'G', valor: '100', referencia: '70 a 99', refMin: '70', refMax: '110' })]);
    expect(html).toContain(L.faixaDiverge);
    expect(descritoPor(html, 'novo-refMin-0')).toContain('novo-diverge-0');
  });

  it('erros da linha: role="alert" junto do campo, com aria-invalid e aria-describedby', () => {
    const html = montar([linha({ nome: 'G', valor: '1', refMin: '120', refMax: '99' })], { 'valores.0.refMin': MSG_EXAMES.lancamentoErros.faixaInvertida });
    expect(html).toMatch(new RegExp(`<p id="novo-refMin-0-erro" role="alert"[^>]*>${MSG_EXAMES.lancamentoErros.faixaInvertida}</p>`));
    expect(tag(html, 'novo-refMin-0')).toContain('aria-invalid="true"');
    expect(descritoPor(html, 'novo-refMin-0')).toContain('novo-refMin-0-erro');
  });

  it('botões da barra: "Adicionar do catálogo", "Carregar modelo de solicitação" (com modelos), "Remover todos" e "Adicionar linha"', () => {
    const html = montar([linha({ nome: 'G' })]);
    for (const b of [L.adicionarDoCatalogo, L.carregarModelo, L.removerTodos, L.adicionarLinha]) expect(html, b).toContain(`>${b}</button>`);
    // nenhum diálogo montado com tudo fechado (o Dialogo só existe aberto, fora do <form> da tela)
    expect(html).not.toContain('<dialog');
  });

  it('a linha que veio da IA: nome, valor e unidade só de leitura', () => {
    const html = montar([linha({ nome: 'Glicose de jejum', valor: '92', unidade: 'mg/dL', origem: 0, daIa: true })]);
    for (const c of ['nome', 'valor', 'unidade']) expect(tag(html, `novo-${c}-0`), c).toContain('readOnly=""');
    expect(tag(html, 'novo-refMin-0')).not.toContain('readOnly');
  });
});
