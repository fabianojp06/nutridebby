import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import type { Comparativo } from '@/modules/exames/comparativo';
import { AvisosDaClassificacao, TabelaClassificada, TabelaComparativa, type LinhaClassificada } from './tabela-classificada';

/**
 * Plano 22 (T5b, spec §7 "Detalhe do exame" e "Comparativo", RN-379, RN-382, RN-384): só a estrutura (sem DOM; o Vitest roda
 * em `environment: 'node'`). Tabela com `caption`, `th scope`, a região rolável focável com o contorno para dentro
 * (`cores.test.ts`), a classificação em texto (nunca só cor) e os avisos fixos ligados por `aria-describedby`.
 */
const C = MSG_EXAMES.classificacao;
const linha = (o: Partial<LinhaClassificada> = {}): LinhaClassificada => ({
  nome: 'Glicemia de jejum',
  valor: 105,
  unidade: 'mg/dL',
  referencia: '70 a 99',
  neutra: 'acima',
  categoria: null,
  ref: null,
  ...o,
});
const tabela = (linhas: LinhaClassificada[], extra: Partial<Parameters<typeof TabelaClassificada>[0]> = {}) =>
  renderToStaticMarkup(createElement(TabelaClassificada, { id: 'ex', legenda: 'Valores do exame Rotina', linhas, ...extra }));
const descritoPor = (html: string) => (html.match(/<table[^>]*aria-describedby="([^"]*)"/)?.[1] ?? '').split(' ').filter(Boolean);
const regiao = (html: string) => html.match(/<div [^>]*role="region"[^>]*>/)?.[0] ?? '';

describe('TabelaClassificada (lista e detalhe)', () => {
  it('caption com id, a região rolável focável ligada a ele e com o contorno para dentro', () => {
    const html = tabela([linha()]);
    expect(html).toMatch(/<caption id="ex-legenda"[^>]*>Valores do exame Rotina<\/caption>/);
    const r = regiao(html);
    expect(r).toContain('aria-labelledby="ex-legenda"');
    expect(r).toContain('tabindex="0"');
    expect(r).toMatch(/overflow-x-auto/);
    expect(r).toMatch(/focus-visible:outline-offset-\[-3px\]/);
  });

  it('cabeçalhos com scope="col" (Marcador · Valor · Referência do laudo · Classificação · Ver referência) e o marcador com scope="row"', () => {
    const html = tabela([linha({ ref: { referencia: '70 a 99', refMin: 70, refMax: 99, faixas: [], unidadeDoCatalogo: null } })]);
    for (const c of ['Marcador', 'Valor', 'Referência do laudo', 'Classificação', MSG_EXAMES.ref.botao]) expect(html, c).toContain(`<th scope="col"`);
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(['Marcador', 'Valor', 'Referência do laudo', 'Classificação', MSG_EXAMES.ref.botao]);
    expect(html).toMatch(/<th scope="row"[^>]*>Glicemia de jejum<\/th>/);
    // "Ver referência" com o nome acessível "Referência de {marcador}"
    expect(html).toContain(`aria-label="${MSG_EXAMES.ref.rotulo('Glicemia de jejum')}"`);
  });

  it('sem "Ver referência" (nenhuma linha com ref): sem a coluna', () => {
    const html = tabela([linha()]);
    expect(html).not.toContain(MSG_EXAMES.ref.botao);
  });

  it('a classificação é texto: a neutra e, ao lado, a categoria com "(faixa do consultório)"; sem nada → "—"', () => {
    const html = tabela([linha({ categoria: 'Alto' }), linha({ nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: null, neutra: null })]);
    expect(html).toContain(C.acima);
    expect(html).toContain(`Alto ${C.faixaDoConsultorio}`);
    expect(html).toMatch(/<td[^>]*>—<\/td>/);
    expect(html).toContain('105 mg/dL');
  });

  it('os avisos fixos vêm antes da tabela e ligados a ela por aria-describedby; o de gestação só com categoria', () => {
    const sem = tabela([linha()]);
    expect(sem.split(C.aviso)).toHaveLength(2);
    expect(sem.indexOf(C.aviso)).toBeLessThan(sem.indexOf('<table'));
    const idAviso = sem.match(new RegExp(`<p id="([^"]+)"[^>]*>${C.aviso.replace(/\./g, '\\.')}</p>`))?.[1];
    expect(idAviso).toBeTruthy();
    expect(descritoPor(sem)).toEqual([idAviso]);
    expect(sem).not.toContain(C.gestacao);

    const com = tabela([linha({ categoria: 'Alto' })]);
    const idGestacao = com.match(new RegExp(`<p id="([^"]+)"[^>]*>${C.gestacao.replace(/\./g, '\\.')}</p>`))?.[1];
    expect(descritoPor(com)).toEqual([idAviso, idGestacao]);

    // sem classificação nenhuma: sem aviso e sem aria-describedby
    const nada = tabela([linha({ neutra: null })]);
    expect(nada).not.toContain(C.aviso);
    expect(nada).not.toContain('aria-describedby');
  });

  it('com os avisos fora da tabela (lista da aba: um aviso só para todos os exames), a tabela cita os ids de fora', () => {
    const html = tabela([linha({ categoria: 'Alto' })], { avisosDeFora: { classificacao: 'aba-aviso', gestacao: 'aba-gestacao' } });
    expect(html).not.toContain(C.aviso);
    expect(descritoPor(html)).toEqual(['aba-aviso', 'aba-gestacao']);
    const avisos = renderToStaticMarkup(createElement(AvisosDaClassificacao, { ids: { classificacao: 'aba-aviso', gestacao: 'aba-gestacao' }, comCategoria: true }));
    expect(avisos).toContain(`<p id="aba-aviso" class="text-sm text-suave">${C.aviso}</p>`);
    expect(avisos).toContain(`<p id="aba-gestacao" class="text-sm text-suave">${C.gestacao}</p>`);
  });

  it('a marca da IA fica junto do valor', () => {
    expect(tabela([linha({ marca: 'IA · conferido em 02/09/2026' })])).toContain('IA · conferido em 02/09/2026');
  });
});

describe('TabelaComparativa (US-374)', () => {
  const comp: Comparativo = {
    exames: [
      { id: 'a', titulo: 'Rotina', data: '2026-01-10' },
      { id: 'b', titulo: 'Retorno', data: '2026-03-10' },
    ],
    linhas: [
      { marcador: 'Glicemia de jejum', unidade: 'mg/dL', celulas: [{ valor: 90, unidade: 'mg/dL', neutra: 'dentro' }, { valor: 105, unidade: 'mg/dL', neutra: 'acima' }] },
      { marcador: 'Glicemia de jejum', unidade: 'mmol/L', celulas: [null, { valor: 5.5, unidade: 'mmol/L', neutra: null }] },
    ],
    unidadesSeparadas: true,
  };
  const html = renderToStaticMarkup(createElement(TabelaComparativa, { id: 'cmp', comparativo: comp }));

  it('caption "Resultados por data" com id; a região rolável focável ligada a ele, com o contorno para dentro', () => {
    expect(html).toMatch(new RegExp(`<caption id="cmp-legenda"[^>]*>${MSG_EXAMES.comparativo.caption}</caption>`));
    const r = regiao(html);
    expect(r).toContain('aria-labelledby="cmp-legenda"');
    expect(r).toContain('tabindex="0"');
    expect(r).toMatch(/focus-visible:outline-offset-\[-3px\]/);
  });

  it('as datas nas colunas (th scope="col", mais antiga à esquerda) e os marcadores nas linhas (th scope="row", com a unidade)', () => {
    const cols = [...html.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    expect(cols[0]).toBe(MSG_EXAMES.comparativo.marcador);
    expect(cols[1]).toContain('10/01/2026');
    expect(cols[1]).toContain('Rotina');
    expect(cols[2]).toContain('10/03/2026');
    const linhas = [...html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => m[1]);
    expect(linhas).toEqual(['Glicemia de jejum (mg/dL)', 'Glicemia de jejum (mmol/L)']);
  });

  it('célula com valor, unidade e a neutra em texto; "—" sem o marcador; a nota das unidades e o aviso ligado à tabela', () => {
    expect(html).toContain('105 mg/dL');
    expect(html).toContain(C.acima);
    expect(html).toContain(C.dentro);
    expect(html).toMatch(/<td[^>]*>—<\/td>/);
    expect(html).toContain(MSG_EXAMES.comparativo.nota);
    const idAviso = html.match(new RegExp(`<p id="([^"]+)"[^>]*>${C.aviso.replace(/\./g, '\\.')}</p>`))?.[1];
    expect(descritoPor(html)).toContain(idAviso);
    // sem categoria do consultório nem "Ver referência" (RN-384)
    expect(html).not.toContain(C.faixaDoConsultorio);
    expect(html).not.toContain(C.gestacao);
  });

  it('sem unidades separadas, sem a nota', () => {
    const uma = renderToStaticMarkup(createElement(TabelaComparativa, { id: 'cmp', comparativo: { ...comp, linhas: [comp.linhas[0]], unidadesSeparadas: false } }));
    expect(uma).not.toContain(MSG_EXAMES.comparativo.nota);
  });
});
