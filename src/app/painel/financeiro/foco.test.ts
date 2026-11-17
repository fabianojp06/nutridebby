import { afterEach, describe, expect, it, vi } from 'vitest';
import { focarTitulo, ID_TITULO } from './foco';

/** O foco depois de salvar (§7): o primeiro alvo que está na tela; sem alvos, o h1 do Financeiro. */
describe('focarTitulo', () => {
  afterEach(() => vi.unstubAllGlobals());
  function tela(ids: string[]) {
    const focados: string[] = [];
    vi.stubGlobal('document', {
      getElementById: (id: string) => (ids.includes(id) ? { focus: () => focados.push(id) } : null),
    });
    return focados;
  }

  it('sem alvos: o h1 do Financeiro', () => {
    const focados = tela([ID_TITULO]);
    focarTitulo();
    expect(focados).toEqual([ID_TITULO]);
  });

  it('o primeiro alvo que está na tela, um só (seção "Cobrança" → h2; sem a seção → h1 da consulta)', () => {
    let focados = tela(['cobranca', 'titulo-consulta']);
    focarTitulo(['cobranca', 'titulo-consulta']);
    expect(focados).toEqual(['cobranca']);
    focados = tela(['titulo-consulta']);
    focarTitulo(['cobranca', 'titulo-consulta']);
    expect(focados).toEqual(['titulo-consulta']);
  });

  it('nenhum alvo na tela: não faz nada', () => {
    const focados = tela([]);
    expect(() => focarTitulo(['cobranca'])).not.toThrow();
    expect(focados).toEqual([]);
  });
});
