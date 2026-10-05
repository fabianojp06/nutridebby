import { describe, expect, it } from 'vitest';
import { DocumentoError } from './erros';
import { descreverItem, MSG_PRESCRICAO, validarParaPreparar, validarRascunho } from './prescricao';

const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia, no almoço' };
const curcuma = { tipo: 'derivado_vegetal', nomenclatura: 'Curcuma longa L.', parte: 'Rizoma', formaFarmaceutica: 'Cápsula', dose: '500 mg', via: 'oral', posologia: '1 cápsula ao dia' };
const erroEm = (chave: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[chave] === msg;

describe('receita (US-142, RN-149, RN-150)', () => {
  it('aceita suplemento e derivado vegetal sem habilitação; quantidade com vírgula vira número', () => {
    const c = validarRascunho({ itens: [{ ...vitD, composicao: [{ nome: 'Vitamina D3', quantidade: '2000,5', unidade: 'UI' }] }, curcuma], orientacoes: '' }, { habilitada: false });
    expect(c.itens[0]).toMatchObject({ tipo: 'suplemento', composicao: [{ quantidade: 2000.5 }] });
    expect(c.itens).toHaveLength(2);
  });
  it('probiótico só em UFC e enzima só em U, com o texto da spec', () => {
    // expect.unreachable() nos dois: sem ele, o teste passaria mesmo se a validação não lançasse (Minor da revisão de cobertura)
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'probiotico', composicao: [{ nome: 'L. acidophilus', quantidade: '10', unidade: 'mg' }] }] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.composicao.0.unidade', MSG_PRESCRICAO.probiotico)(e)).toBe(true);
    }
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'enzima', composicao: [{ nome: 'Lactase', quantidade: '9000', unidade: 'UI' }] }] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.composicao.0.unidade', MSG_PRESCRICAO.enzima)(e)).toBe(true);
    }
  });
  it('chá só com infusão, decocção ou maceração; via anorretal e injetável não existem', () => {
    expect(() => validarRascunho({ itens: [{ tipo: 'planta_cha', nomenclatura: 'Matricaria chamomilla L.', parte: 'Flores', modoPreparo: 'tintura', formaUso: '1 xícara', posologia: '2x ao dia' }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, via: 'retal' }] }, { habilitada: false })).toThrow(DocumentoError);
  });
  it('fitoterápico formulado: recusado sem habilitação (com a mensagem da spec), aceito com ela', () => {
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' };
    try {
      validarRascunho({ itens: [fito] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.tipo', MSG_PRESCRICAO.semHabilitacao)(e)).toBe(true);
    }
    expect(validarRascunho({ itens: [fito] }, { habilitada: true }).itens).toHaveLength(1);
  });
  it('limites: 21 itens, 11 componentes, quantidade 0 ou 1e9, posologia com 301 caracteres', () => {
    expect(() => validarRascunho({ itens: Array(21).fill(vitD) }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: Array(11).fill(vitD.composicao[0]) }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade: '0' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade: '1e9' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, posologia: 'x'.repeat(301) }] }, { habilitada: false })).toThrow(DocumentoError);
  });
  it('para preparar: ao menos 1 item e a justificativa (texto da spec); a habilitação é conferida de novo', () => {
    const vazio = validarRascunho({ itens: [] }, { habilitada: false });
    expect(() => validarParaPreparar(vazio, 'ok', { habilitada: false })).toThrow(MSG_PRESCRICAO.semItens);
    const c = validarRascunho({ itens: [vitD] }, { habilitada: false });
    try {
      validarParaPreparar(c, '  ', { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('justificativa', MSG_PRESCRICAO.justificativa)(e)).toBe(true);
    }
    const fito = validarRascunho({ itens: [{ tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' }] }, { habilitada: true });
    expect(() => validarParaPreparar(fito, 'Ansiedade leve', { habilitada: false })).toThrow(DocumentoError); // habilitação retirada entre salvar e preparar
  });
  it('descreve o item para o PDF e o portal (sem a justificativa)', () => {
    const [item] = validarRascunho({ itens: [vitD] }, { habilitada: false }).itens;
    expect(descreverItem(item)).toEqual({ titulo: 'Vitamina D3 2000 UI', linhas: ['Suplemento alimentar (Nutriente) · Cápsula', 'Via: Oral', 'Posologia: 1 cápsula ao dia, no almoço'] });
  });
});
