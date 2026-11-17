import { describe, expect, it } from 'vitest';
import { indiceDoCatalogo, type ExameParaCasar } from './classificacao';
import { CatalogoError, expandirParaAnalise, faixasSeSobrepoem, validarExameDoCatalogo, validarListaDeExames } from './catalogo-regras';
import { MSG_EXAMES } from './constantes';
import { MSG_SOLICITACAO } from '@/modules/documentos/solicitacao';

const faixa = { sexo: null, idadeMin: '18', idadeMax: '120', aPartirDe: '', abaixoDe: '20', categoria: 'Deficiência', fonte: 'Diretriz X, 2024' };
const base = { nome: 'Vitamina D', unidade: 'ng/mL', sinonimos: ['25-hidroxivitamina D'], componentes: [], faixas: [faixa], modeloNotaAbaixo: '', modeloNotaAcima: '' };

/** A mensagem da chave (ou a primeira, sem chave) que `validarExameDoCatalogo` lança. */
function erroDe(input: unknown, chave?: string): string | undefined {
  try {
    validarExameDoCatalogo(input);
  } catch (e) {
    if (!(e instanceof CatalogoError)) throw e;
    return chave ? e.erros[chave] : Object.values(e.erros)[0];
  }
  return undefined;
}

describe('exame do catálogo (RN-371, RN-373 a RN-375; "Catálogo: erros" da §6.2)', () => {
  it('o válido sai normalizado: números da faixa por lerDecimal, vazios viram null', () => {
    const e = validarExameDoCatalogo({ ...base, nome: '  Vitamina   D ', modeloNotaAcima: 'Investigar suplementação.' });
    expect(e).toEqual({
      nome: 'Vitamina D',
      unidade: 'ng/mL',
      sinonimos: ['25-hidroxivitamina D'],
      componentes: [],
      faixas: [{ sexo: null, idadeMin: 18, idadeMax: 120, aPartirDe: null, abaixoDe: 20, categoria: 'Deficiência', fonte: 'Diretriz X, 2024' }],
      modeloNotaAbaixo: null,
      modeloNotaAcima: 'Investigar suplementação.',
    });
    // outros nomes e componentes também por linha (o formulário manda texto)
    expect(validarExameDoCatalogo({ nome: 'Ferritina', unidade: '', sinonimos: 'ferritina sérica\n\n  ', faixas: [] }).sinonimos).toEqual(['ferritina sérica']);
    expect(validarExameDoCatalogo({ nome: 'Lipidograma', componentes: 'Colesterol total\nHDL' }).componentes).toEqual(['Colesterol total', 'HDL']);
  });
  it('nome 0 e 81 caracteres', () => {
    expect(erroDe({ ...base, nome: '' }, 'nome')).toBe('O nome tem de 1 a 80 caracteres.');
    expect(erroDe({ ...base, nome: 'x'.repeat(81) }, 'nome')).toBe('O nome tem de 1 a 80 caracteres.');
  });
  it('11 outros nomes', () => {
    expect(erroDe({ ...base, sinonimos: Array.from({ length: 11 }, (_, i) => `V${i}`) }, 'sinonimos')).toBe('Use até 10 outros nomes.');
  });
  it('painel com 1 e 31 componentes', () => {
    const painel = { nome: 'Hemograma completo', unidade: '', faixas: [] };
    expect(erroDe({ ...painel, componentes: ['Hemácias'] }, 'componentes')).toBe('Um painel tem de 2 a 30 exames.');
    expect(erroDe({ ...painel, componentes: Array.from({ length: 31 }, (_, i) => `C${i}`) }, 'componentes')).toBe('Um painel tem de 2 a 30 exames.');
    expect(validarExameDoCatalogo({ ...painel, componentes: Array.from({ length: 30 }, (_, i) => `C${i}`) }).componentes).toHaveLength(30);
  });
  it('painel com unidade, faixa ou modelo de nota', () => {
    const msg = 'Um painel não tem unidade, faixas nem modelos de nota.';
    expect(erroDe({ nome: 'Hemograma', componentes: ['A', 'B'], unidade: 'g/dL' }, 'componentes')).toBe(msg);
    expect(erroDe({ nome: 'Hemograma', componentes: ['A', 'B'], faixas: [faixa] }, 'componentes')).toBe(msg);
    expect(erroDe({ nome: 'Hemograma', componentes: ['A', 'B'], modeloNotaAbaixo: 'x' }, 'componentes')).toBe(msg);
  });
  it('faixa sem unidade', () => {
    expect(erroDe({ ...base, unidade: '' }, 'faixas')).toBe('Informe a unidade do exame antes de cadastrar faixas.');
  });
  it('fonte com 1 e 301 caracteres', () => {
    const msg = 'Informe a fonte (de 2 a 300 caracteres).';
    expect(erroDe({ ...base, faixas: [{ ...faixa, fonte: 'X' }] }, 'faixas.0.fonte')).toBe(msg);
    expect(erroDe({ ...base, faixas: [{ ...faixa, fonte: 'x'.repeat(301) }] }, 'faixas.0.fonte')).toBe(msg);
  });
  it('sem limite; "A partir de" 30 e "Abaixo de" 20; número inválido', () => {
    expect(erroDe({ ...base, faixas: [{ ...faixa, aPartirDe: '', abaixoDe: '' }] }, 'faixas.0.aPartirDe')).toBe('Informe ao menos um limite.');
    expect(erroDe({ ...base, faixas: [{ ...faixa, aPartirDe: '30', abaixoDe: '20' }] }, 'faixas.0.abaixoDe')).toBe('O limite inicial deve ser menor que o final.');
    expect(erroDe({ ...base, faixas: [{ ...faixa, aPartirDe: '20', abaixoDe: '20' }] }, 'faixas.0.abaixoDe')).toBe('O limite inicial deve ser menor que o final.');
    expect(erroDe({ ...base, faixas: [{ ...faixa, abaixoDe: '20 ng' }] }, 'faixas.0.abaixoDe')).toBe('Faixa inválida. Use só números, como 70 ou 4,5.');
    expect(erroDe({ ...base, faixas: [{ ...faixa, abaixoDe: '1e16' }] }, 'faixas.0.abaixoDe')).toBe('Faixa inválida. Use só números, como 70 ou 4,5.');
  });
  it('idade 50 a 18; idade fora de 0 a 130', () => {
    expect(erroDe({ ...base, faixas: [{ ...faixa, idadeMin: '50', idadeMax: '18' }] }, 'faixas.0.idadeMax')).toBe('A idade inicial deve ser menor ou igual à final.');
    expect(erroDe({ ...base, faixas: [{ ...faixa, idadeMax: '131' }] }, 'faixas.0.idadeMax')).toBe(MSG_EXAMES.erros.idade);
    expect(erroDe({ ...base, faixas: [{ ...faixa, idadeMin: '1,5' }] }, 'faixas.0.idadeMin')).toBe(MSG_EXAMES.erros.idade);
  });
  it('categoria fora da lista fechada; sexo fora de F, M ou Todos', () => {
    expect(erroDe({ ...base, faixas: [{ ...faixa, categoria: 'Desnutrição' }] }, 'faixas.0.categoria')).toBe(MSG_EXAMES.erros.categoria);
    expect(erroDe({ ...base, faixas: [{ ...faixa, sexo: 'X' }] }, 'faixas.0.sexo')).toBe(MSG_EXAMES.erros.sexo);
    expect(validarExameDoCatalogo({ ...base, faixas: [{ ...faixa, sexo: 'F' }] }).faixas[0].sexo).toBe('F');
    expect(validarExameDoCatalogo({ ...base, faixas: [{ ...faixa, sexo: '' }] }).faixas[0].sexo).toBeNull();
  });
  it('21 faixas', () => {
    const faixas = Array.from({ length: 21 }, (_, i) => ({ ...faixa, idadeMin: String(i), idadeMax: String(i) }));
    expect(erroDe({ ...base, faixas }, 'faixas')).toBe('Use até 20 faixas.');
  });
  it('faixas que se sobrepõem no mesmo exame', () => {
    expect(erroDe({ ...base, faixas: [faixa, { ...faixa, idadeMin: '40', abaixoDe: '25', categoria: 'Insuficiente' }] }, 'faixas.1.abaixoDe')).toBe('Esta faixa se sobrepõe a outra do mesmo público.');
  });
  it('modelo de nota com 1001 caracteres', () => {
    expect(erroDe({ ...base, modeloNotaAbaixo: 'x'.repeat(1001) }, 'modeloNotaAbaixo')).toBe('O modelo de nota tem no máximo 1000 caracteres.');
    expect(erroDe({ ...base, modeloNotaAcima: 'x'.repeat(1001) }, 'modeloNotaAcima')).toBe('O modelo de nota tem no máximo 1000 caracteres.');
  });
  it('outro nome ou componente repetido sem diferença de acento e maiúsculas', () => {
    expect(erroDe({ nome: 'Hemograma', componentes: ['Hemácias', 'HEMACIAS'] }, 'componentes')).toBe(MSG_EXAMES.erros.componenteRepetido);
    expect(validarExameDoCatalogo({ ...base, sinonimos: ['25-hidroxivitamina D', '25 hidroxivitamina d', 'vitamina d'] }).sinonimos).toEqual(['25-hidroxivitamina D']);
  });
});

describe('faixasSeSobrepoem (RN-374)', () => {
  const f = { sexo: null, idadeMin: null, idadeMax: null, aPartirDe: null, abaixoDe: null, categoria: 'Normal', fonte: 'X 2024' } as const;
  it('mesmo sexo, idades e valores que se cruzam → sobrepõe', () => {
    expect(faixasSeSobrepoem({ ...f, sexo: 'F', idadeMin: 18, idadeMax: 60, abaixoDe: 20 }, { ...f, sexo: 'F', idadeMin: 40, abaixoDe: 25 })).toBe(true);
  });
  it('"Todos" coincide com F', () => {
    expect(faixasSeSobrepoem({ ...f, abaixoDe: 20 }, { ...f, sexo: 'F', abaixoDe: 10 })).toBe(true);
    expect(faixasSeSobrepoem({ ...f, sexo: 'M', abaixoDe: 20 }, { ...f, sexo: 'F', abaixoDe: 10 })).toBe(false);
  });
  it('idades disjuntas → não', () => {
    expect(faixasSeSobrepoem({ ...f, idadeMin: 0, idadeMax: 17, abaixoDe: 20 }, { ...f, idadeMin: 18, abaixoDe: 20 })).toBe(false);
  });
  it('valores encostados [x, 20) e [20, y) → não', () => {
    expect(faixasSeSobrepoem({ ...f, aPartirDe: 10, abaixoDe: 20 }, { ...f, aPartirDe: 20, abaixoDe: 30 })).toBe(false);
    expect(faixasSeSobrepoem({ ...f, abaixoDe: 20 }, { ...f, aPartirDe: 20 })).toBe(false);
    expect(faixasSeSobrepoem({ ...f, abaixoDe: 20.5 }, { ...f, aPartirDe: 20 })).toBe(true);
  });
});

describe('expandirParaAnalise (RN-373)', () => {
  const componentes = Array.from({ length: 20 }, (_, i) => `Componente ${i + 1}`);
  const catalogo: ExameParaCasar[] = [
    { id: 'h', nome: 'Hemograma completo', unidade: null, sinonimos: [], componentes, faixas: [] },
    { id: 'c1', nome: 'Componente 1', unidade: 'milhões/mm³', sinonimos: [], componentes: [], faixas: [] },
    { id: 'c2', nome: 'Hemoglobina', unidade: 'g/dL', sinonimos: ['Componente 2'], componentes: [], faixas: [] },
    { id: 'c3', nome: 'Componente 3', unidade: null, sinonimos: [], componentes: ['X', 'Y'], faixas: [] },
    { id: 'g', nome: 'Glicose', unidade: 'mg/dL', sinonimos: [], componentes: [], faixas: [] },
  ];
  const I = indiceDoCatalogo(catalogo);
  it('painel "Hemograma completo" de 20 componentes → 20 linhas, unidade do catálogo pelo nome ou outro nome, sem unidade quando não casa', () => {
    const linhas = expandirParaAnalise([{ nome: 'Hemograma completo', painel: true }], I);
    expect(linhas).toHaveLength(20);
    expect(linhas[0]).toEqual({ nome: 'Componente 1', unidade: 'milhões/mm³' });
    expect(linhas[1]).toEqual({ nome: 'Componente 2', unidade: 'g/dL' });
    expect(linhas[4]).toEqual({ nome: 'Componente 5', unidade: null });
  });
  it('componente que é painel não expande de novo', () => {
    const linhas = expandirParaAnalise([{ nome: 'Hemograma completo', painel: true }], I);
    expect(linhas[2]).toEqual({ nome: 'Componente 3', unidade: null });
    expect(linhas.map((l) => l.nome)).not.toContain('X');
  });
  it('exame comum vira uma linha com a unidade do catálogo; fora do catálogo, sem unidade', () => {
    expect(expandirParaAnalise([{ nome: 'glicose' }, { nome: 'Ferritina' }], I)).toEqual([
      { nome: 'glicose', unidade: 'mg/dL' },
      { nome: 'Ferritina', unidade: null },
    ]);
  });
});

describe('validarListaDeExames (RN-388, RN-391)', () => {
  it('41 → "A solicitação pode ter até 40 exames."; repetido normalizado → "Este exame já está na lista."', () => {
    const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ nome: `Exame ${i}` }));
    expect(validarListaDeExames(lista(40), { max: 40 })).toHaveLength(40);
    expect(() => validarListaDeExames(lista(41), { max: 40 })).toThrow('A solicitação pode ter até 40 exames.');
    expect(() => validarListaDeExames([{ nome: 'Glicose' }, { nome: ' GLICOSE ' }], { max: 40 })).toThrow('Este exame já está na lista.');
    expect(() => validarListaDeExames([], { max: 40 })).toThrow('Inclua ao menos um exame.');
    expect(() => validarListaDeExames([{ nome: '' }], { max: 40 })).toThrow('O nome do exame tem de 1 a 80 caracteres.');
    expect(() => validarListaDeExames([{ nome: 'x'.repeat(81) }], { max: 40 })).toThrow('O nome do exame tem de 1 a 80 caracteres.');
  });
  it('painel só como `true`; chaves a mais somem; o modelo usa os textos dele', () => {
    expect(validarListaDeExames([{ nome: ' Hemograma  completo ', painel: true, laboratorio: 'X' }, { nome: 'Glicose', painel: false }], { max: 40 })).toEqual([
      { nome: 'Hemograma completo', painel: true },
      { nome: 'Glicose' },
    ]);
    expect(() => validarListaDeExames(Array.from({ length: 41 }, (_, i) => ({ nome: `E${i}` })), { max: 40, para: 'modelo' })).toThrow('O modelo pode ter até 40 exames.');
    expect(validarListaDeExames([], { max: 40, min: 0 })).toEqual([]);
    expect(MSG_SOLICITACAO.erros.repetido).toBe('Este exame já está na lista.');
  });
});
