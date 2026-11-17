import { describe, expect, it } from 'vitest';
import type { FaixaDoConsultorio } from '@/db/schema/exames-catalogo';
import {
  casarComCatalogo,
  categoriaDoConsultorio,
  classificarNeutra,
  faixaDiverge,
  foraParaOApp,
  indiceDoCatalogo,
  referenciaDaFaixa,
  ROTULO_NEUTRA,
  sugerirFaixa,
  type ExameParaCasar,
} from './classificacao';

const faixa = (f: Partial<FaixaDoConsultorio>): FaixaDoConsultorio => ({
  sexo: null,
  idadeMin: null,
  idadeMax: null,
  aPartirDe: null,
  abaixoDe: null,
  categoria: 'Normal',
  fonte: 'Diretriz X, 2024',
  atualizadaEm: '2026-11-01',
  ...f,
});
const exame = (e: Partial<ExameParaCasar> & { nome: string }): ExameParaCasar => ({ id: e.nome, unidade: null, sinonimos: [], componentes: [], faixas: [], ...e });

const deficiencia = faixa({ idadeMin: 18, idadeMax: 120, abaixoDe: 20, categoria: 'Deficiência' });
const vitD = exame({ nome: 'Vitamina D', unidade: 'ng/mL', sinonimos: ['25-hidroxivitamina D'], faixas: [deficiencia, faixa({ idadeMin: 18, idadeMax: 120, aPartirDe: 20, abaixoDe: 30, categoria: 'Insuficiente' })] });
const indice = indiceDoCatalogo([vitD, exame({ nome: 'Glicose', unidade: 'mg/dL' })]);
const paciente = { sexo: 'F', dataNascimento: '1986-05-10' };

describe('classificação neutra (RN-379, US-372)', () => {
  it('os quatro exemplos da US-372', () => {
    expect(classificarNeutra(105, 70, 99)).toBe('acima');
    expect(classificarNeutra(70, 70, 99)).toBe('dentro');
    expect(classificarNeutra(210, null, 200)).toBe('acima');
    expect(classificarNeutra(90)).toBeNull();
    expect(classificarNeutra(90, null, null)).toBeNull();
  });
  it('limites inclusivos; "Abaixo" com só o mínimo', () => {
    expect(classificarNeutra(99, 70, 99)).toBe('dentro');
    expect(classificarNeutra(69.9, 70, 99)).toBe('abaixo');
    expect(classificarNeutra(29, 30)).toBe('abaixo');
    expect(classificarNeutra(30, 30)).toBe('dentro');
  });
  it('rótulos exatos da §6.2', () => {
    expect(ROTULO_NEUTRA).toEqual({ abaixo: 'Abaixo da referência', dentro: 'Dentro da referência', acima: 'Acima da referência' });
  });
});

describe('categoria do consultório (RN-380)', () => {
  const linha = { nome: '25-hidroxivitamina D', valor: 15, unidade: 'ng/mL' };
  it('cenário "Vitamina D": F, 40 anos na data do exame, outro nome, ng/mL, valor 15 → "Deficiência" com a faixa', () => {
    expect(categoriaDoConsultorio(linha, indice, paciente, '2026-11-01')).toEqual({ categoria: 'Deficiência', faixa: deficiencia });
    // o nome principal também casa; a unidade compara sem diferença de maiúsculas
    expect(categoriaDoConsultorio({ ...linha, nome: 'vitamina d', unidade: 'NG/ML' }, indice, paciente, '2026-11-01')?.categoria).toBe('Deficiência');
  });
  it('mesma linha em nmol/L → null; sem unidade → null', () => {
    expect(categoriaDoConsultorio({ ...linha, unidade: 'nmol/L' }, indice, paciente, '2026-11-01')).toBeNull();
    expect(categoriaDoConsultorio({ ...linha, unidade: null }, indice, paciente, '2026-11-01')).toBeNull();
    expect(categoriaDoConsultorio({ ...linha, unidade: '  ' }, indice, paciente, '2026-11-01')).toBeNull();
  });
  it('sexo ou nascimento nulos → null', () => {
    expect(categoriaDoConsultorio(linha, indice, { sexo: null, dataNascimento: '1986-05-10' }, '2026-11-01')).toBeNull();
    expect(categoriaDoConsultorio(linha, indice, { sexo: 'F', dataNascimento: null }, '2026-11-01')).toBeNull();
  });
  it('menos de 1 ano na data do exame → null, mesmo com faixa sem idade', () => {
    const I = indiceDoCatalogo([exame({ nome: 'Ferritina', unidade: 'ng/mL', faixas: [faixa({ abaixoDe: 30, categoria: 'Baixo' })] })]);
    expect(categoriaDoConsultorio({ nome: 'Ferritina', valor: 10, unidade: 'ng/mL' }, I, { sexo: 'M', dataNascimento: '2026-01-15' }, '2026-11-01')).toBeNull();
    expect(categoriaDoConsultorio({ nome: 'Ferritina', valor: 10, unidade: 'ng/mL' }, I, { sexo: 'M', dataNascimento: '2025-11-01' }, '2026-11-01')?.categoria).toBe('Baixo');
  });
  it('idade na data do exame, não hoje: aniversário no dia do exame conta', () => {
    const I = indiceDoCatalogo([exame({ nome: 'Ferritina', unidade: 'ng/mL', faixas: [faixa({ idadeMin: 18, abaixoDe: 30, categoria: 'Baixo' })] })]);
    const l = { nome: 'Ferritina', valor: 10, unidade: 'ng/mL' };
    expect(categoriaDoConsultorio(l, I, { sexo: 'F', dataNascimento: '2008-11-01' }, '2026-11-01')?.categoria).toBe('Baixo');
    expect(categoriaDoConsultorio(l, I, { sexo: 'F', dataNascimento: '2008-11-02' }, '2026-11-01')).toBeNull();
  });
  it('sexo da faixa: F não serve para M; "Todos" serve para os dois', () => {
    const I = indiceDoCatalogo([exame({ nome: 'Ferritina', unidade: 'ng/mL', faixas: [faixa({ sexo: 'F', abaixoDe: 30, categoria: 'Baixo' })] })]);
    const l = { nome: 'Ferritina', valor: 10, unidade: 'ng/mL' };
    expect(categoriaDoConsultorio(l, I, { sexo: 'M', dataNascimento: '1990-01-01' }, '2026-11-01')).toBeNull();
    expect(categoriaDoConsultorio(l, I, { sexo: 'F', dataNascimento: '1990-01-01' }, '2026-11-01')?.categoria).toBe('Baixo');
  });
  it('faixa só com "A partir de" (inclusivo) e só com "Abaixo de" (exclusivo)', () => {
    const I = indiceDoCatalogo([exame({ nome: 'Glicose', unidade: 'mg/dL', faixas: [faixa({ abaixoDe: 100, categoria: 'Normal' }), faixa({ aPartirDe: 100, categoria: 'Elevado' })] })]);
    const cat = (valor: number) => categoriaDoConsultorio({ nome: 'Glicose', valor, unidade: 'mg/dL' }, I, paciente, '2026-11-01')?.categoria;
    expect(cat(99.9)).toBe('Normal');
    expect(cat(100)).toBe('Elevado');
    expect(cat(500)).toBe('Elevado');
  });
  it('nenhuma faixa contém o valor → null', () => {
    expect(categoriaDoConsultorio({ ...linha, valor: 40 }, indice, paciente, '2026-11-01')).toBeNull();
  });
  it('nome que casa com dois exames do catálogo → null (EP-D14)', () => {
    const I = indiceDoCatalogo([
      exame({ nome: 'Vitamina D', unidade: 'ng/mL', faixas: [faixa({ abaixoDe: 20, categoria: 'Deficiência' })] }),
      exame({ nome: '25-OH vitamina D', unidade: 'ng/mL', sinonimos: ['Vitamina D'] }),
    ]);
    expect(casarComCatalogo('Vitamina D', 'ng/mL', I)).toBeNull();
    expect(categoriaDoConsultorio({ nome: 'Vitamina D', valor: 10, unidade: 'ng/mL' }, I, paciente, '2026-11-01')).toBeNull();
  });
  it('casarComCatalogo: nome normalizado, outro nome e mesmaUnidade', () => {
    expect(casarComCatalogo('25 hidroxivitamina D', 'ng/mL', indice)).toMatchObject({ exame: { nome: 'Vitamina D' }, mesmaUnidade: true });
    expect(casarComCatalogo('GLICOSE', 'mmol/L', indice)).toMatchObject({ exame: { nome: 'Glicose' }, mesmaUnidade: false });
    expect(casarComCatalogo('Glicose', null, indice)).toMatchObject({ mesmaUnidade: false });
    expect(casarComCatalogo('Ferritina', 'ng/mL', indice)).toBeNull();
  });
});

describe('sugerirFaixa (RN-377)', () => {
  it('um único padrão "a a b", "a - b" ou "a – b", com vírgula ou ponto e unidade depois', () => {
    expect(sugerirFaixa('70 a 99 mg/dL')).toEqual({ refMin: 70, refMax: 99 });
    expect(sugerirFaixa('4,5 - 6,0')).toEqual({ refMin: 4.5, refMax: 6 });
    expect(sugerirFaixa('4.5 – 6.0 milhões/mm3')).toEqual({ refMin: 4.5, refMax: 6 });
  });
  it('nada com sinais, "até", "acima", "abaixo", ";" ou segunda faixa', () => {
    expect(sugerirFaixa('Desejável < 200; Limítrofe 200 a 239')).toBeNull();
    expect(sugerirFaixa('até 200')).toBeNull();
    expect(sugerirFaixa('70 a 99 e 100 a 125')).toBeNull();
    expect(sugerirFaixa('Acima de 30')).toBeNull();
    expect(sugerirFaixa('abaixo de 5,7')).toBeNull();
    expect(sugerirFaixa('≥ 40')).toBeNull();
    expect(sugerirFaixa('10 a 20 (ATÉ 60 anos)')).toBeNull();
    expect(sugerirFaixa('99 a 70')).toBeNull();
    expect(sugerirFaixa('')).toBeNull();
    expect(sugerirFaixa(null)).toBeNull();
    expect(sugerirFaixa('Negativo')).toBeNull();
  });
});

describe('referenciaDaFaixa, faixaDiverge e foraParaOApp (RN-376, RN-385)', () => {
  it('texto da faixa com vírgula decimal', () => {
    expect(referenciaDaFaixa(70, 99)).toBe('70 a 99');
    expect(referenciaDaFaixa(null, 200)).toBe('até 200');
    expect(referenciaDaFaixa(30)).toBe('a partir de 30');
    expect(referenciaDaFaixa(4.5, 6)).toBe('4,5 a 6');
    expect(referenciaDaFaixa()).toBeNull();
  });
  it('faixaDiverge: texto e faixa numérica diferentes', () => {
    expect(faixaDiverge({ referencia: '70 a 99', refMin: 70, refMax: 110 })).toBe(true);
    expect(faixaDiverge({ referencia: '70 a 99 mg/dL', refMin: 70, refMax: 99 })).toBe(false);
    expect(faixaDiverge({ referencia: 'até 200', refMax: 200 })).toBe(false);
    expect(faixaDiverge({ referencia: null, refMin: 70, refMax: 99 })).toBe(false);
    expect(faixaDiverge({ referencia: '70 a 99' })).toBe(false);
  });
  it('foraParaOApp: null com faixa 70–110 e texto "70 a 99" (N22-07); true/false com faixa coerente; null sem faixa', () => {
    expect(foraParaOApp({ valor: 105, referencia: '70 a 99', refMin: 70, refMax: 110 })).toBeNull();
    expect(foraParaOApp({ valor: 105, referencia: '70 a 99', refMin: 70, refMax: 99 })).toBe(true);
    expect(foraParaOApp({ valor: 60, referencia: null, refMin: 70, refMax: 99 })).toBe(true);
    expect(foraParaOApp({ valor: 80, referencia: '70 a 99', refMin: 70, refMax: 99 })).toBe(false);
    expect(foraParaOApp({ valor: 80, referencia: '70 a 99' })).toBeNull();
  });
});
