import { describe, expect, it } from 'vitest';
import { DocumentoError } from './erros';
import { binomioValido, descreverItem, exigeHabilitacao, MSG_PRESCRICAO, TERMOS_NAO_VEGETAIS, temTermoNaoVegetal, validarParaPreparar, validarRascunho } from './prescricao';

const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia, no almoço' };
const curcuma = { tipo: 'derivado_vegetal', nomenclatura: 'Curcuma longa L.', parte: 'Rizoma', formaFarmaceutica: 'Cápsula', dose: '500 mg', via: 'oral', posologia: '1 cápsula ao dia' };
const erroEm = (chave: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[chave] === msg;
const lanca = (chave: string, msg: string) => (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return erroEm(chave, msg)(e);
  }
  return false;
};

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
  it('limites: 21 itens, 11 componentes, quantidade 0 ou acima do teto, posologia com 301 caracteres', () => {
    expect(() => validarRascunho({ itens: Array(21).fill(vitD) }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: Array(11).fill(vitD.composicao[0]) }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade: '0' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    const qtd = (quantidade: unknown) => () => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade }] }] }, { habilitada: false });
    // teto absurdo, com mensagem própria (revisão da T5, I1: o "maior que zero" confundia)
    expect(qtd('10000000000001')).toSatisfy(lanca('itens.0.composicao.0.quantidade', MSG_PRESCRICAO.quantidadeTeto));
    expect(qtd(1e14)).toSatisfy(lanca('itens.0.composicao.0.quantidade', MSG_PRESCRICAO.quantidadeTeto));
    expect(() => validarRascunho({ itens: [{ ...vitD, posologia: 'x'.repeat(301) }] }, { habilitada: false })).toThrow(DocumentoError);
  });
  it('quantidade em pt-BR: ponto só de milhar, vírgula decimal com até 3 casas; > 0 depois do arredondamento (revisão da T5, I1/I2)', () => {
    const q = (quantidade: unknown, categoria = 'nutriente', unidade = 'UI') =>
      validarRascunho({ itens: [{ ...vitD, categoria, composicao: [{ nome: 'X', quantidade, unidade }] }] }, { habilitada: false }).itens[0];
    const valor = (quantidade: unknown) => (q(quantidade) as { composicao: { quantidade: number }[] }).composicao[0].quantidade;
    expect(valor('50.000')).toBe(50000); // vitamina D3 50.000 UI, nunca 50
    expect(valor('2.000')).toBe(2000);
    expect(valor('2.000,5')).toBe(2000.5);
    expect(valor('1.234.567,125')).toBe(1234567.125);
    expect(valor(' 0,5 ')).toBe(0.5);
    expect(valor('0,001')).toBe(0.001);
    expect(valor(2000.5)).toBe(2000.5); // número (JSON) segue aceito
    // probiótico na dose usual em UFC (10^10) é aceito
    expect((q('10000000000', 'probiotico', 'UFC') as { composicao: { quantidade: number }[] }).composicao[0].quantidade).toBe(1e10);
    expect((q('10.000.000.000', 'probiotico', 'UFC') as { composicao: { quantidade: number }[] }).composicao[0].quantidade).toBe(1e10);
    expect((q(1e10, 'probiotico', 'UFC') as { composicao: { quantidade: number }[] }).composicao[0].quantidade).toBe(1e10);
    const formato = (quantidade: unknown) => expect(() => q(quantidade)).toSatisfy(lanca('itens.0.composicao.0.quantidade', MSG_PRESCRICAO.quantidadeFormato));
    const zero = (quantidade: unknown) => expect(() => q(quantidade)).toSatisfy(lanca('itens.0.composicao.0.quantidade', MSG_PRESCRICAO.quantidade));
    // ponto que não é de milhar, exponencial, hexadecimal, mais de 3 casas e lixo: recusados, nunca reinterpretados
    for (const v of ['1.5', '1.50', '0.500', '2.0000', '50.000.0', '12.34,5', '1e3', '1E3', '0x10', 'Infinity', '0,0004', '1,2345', '1,', ',5', '2 000', '-1', '+1', 'abc']) formato(v);
    // vazio, zero e não finito: "maior que zero"; > 0 conferido depois do arredondamento para 3 casas
    zero('');
    zero(' ');
    zero('0');
    zero('0,000');
    zero(0.0004);
    zero(-1);
    zero(Number.NaN);
    zero(null); // campo ausente ou de outro tipo
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

describe('Plano 22 (P22-02): regras puras da fórmula fitoterápica (RN-392, EP-D26, EP-D48)', () => {
  it('exigeHabilitacao: só fitoterapico e formula_fitoterapica', () => {
    expect(exigeHabilitacao('fitoterapico')).toBe(true);
    expect(exigeHabilitacao('formula_fitoterapica')).toBe(true);
    for (const t of ['suplemento', 'planta_cha', 'derivado_vegetal', '', 'outro']) expect(exigeHabilitacao(t), t).toBe(false);
  });
  it('conferirHabilitacao (pelo exigeHabilitacao) continua recusando fitoterapico sem habilitação, com semHabilitacao', () => {
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' };
    try {
      validarRascunho({ itens: [vitD, fito] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.1.tipo', MSG_PRESCRICAO.semHabilitacao)(e)).toBe(true);
    }
    expect(validarRascunho({ itens: [vitD, fito] }, { habilitada: true }).itens).toHaveLength(2);
  });
  it('binomioValido: "Gênero epíteto" (ou ×), com autor e categorias abaixo de espécie depois', () => {
    for (const n of ['Matricaria chamomilla L.', 'Citrus aurantium var. amara', 'Mentha × piperita', 'Mentha ×piperita L.', 'Capsella bursa-pastoris (L.) Medik.', ' Passiflora  incarnata ']) expect(binomioValido(n), n).toBe(true);
    for (const n of ['camomila', 'matricaria chamomilla', 'Matricaria Chamomilla', 'Matricaria', 'Matricaria ×', 'MATRICARIA chamomilla', '', 'Matricaria 2chamomilla']) expect(binomioValido(n), n).toBe(false);
  });
  it('temTermoNaoVegetal: palavra inteira, sem acento nem diferença de maiúsculas; "L-" no começo de palavra', () => {
    for (const n of ['Picolinato de cromo', 'Vitamina C', 'Creatina monoidratada', 'Glutamina livre', 'Curcumina lipossomal', 'Lactobacillus acidophilus', 'Saccharomyces boulardii', 'curcumina isolada', 'L-teanina', 'ÁCIDO ascórbico', 'Ômega 3', 'sais minerais', 'Colágeno hidrolisado', 'cafeína anidra']) {
      expect(temTermoNaoVegetal(n), n).toBe(true);
    }
    for (const n of ['Matricaria chamomilla L.', 'Curcuma longa L.', 'Camellia sinensis (L.) Kuntze', 'Extrato seco hidroalcoólico', 'Ginkgo biloba L.', 'Valeriana officinalis L.']) {
      expect(temTermoNaoVegetal(n), n).toBe(false);
    }
  });
  it('TERMOS_NAO_VEGETAIS tem a lista da RN-392 (rascunho para a Debby); MSG_PRESCRICAO ganha compostos, binomio e naoVegetal (§6.2)', () => {
    for (const t of ['vitamina', 'mineral', 'aminoácido', 'isolado', 'ácido', 'sulfato', 'citrato', 'quelato', 'picolinato', 'glicinato', 'óxido', 'carbonato', 'cafeína', 'creatina', 'glutamina', 'carnitina', 'taurina', 'glutationa', 'coenzima', 'resveratrol', 'curcumina', 'berberina', 'quercetina', 'piperina', 'melatonina', 'colágeno', 'whey', 'proteína', 'peptídeo', 'ômega', 'cloridrato', 'Lactobacillus', 'Lacticaseibacillus', 'Bifidobacterium', 'Saccharomyces', 'Streptococcus', 'Bacillus']) {
      expect(TERMOS_NAO_VEGETAIS, t).toContain(t);
    }
    expect(MSG_PRESCRICAO.compostos).toBe('Informe de 2 a 10 compostos vegetais.');
    expect(MSG_PRESCRICAO.binomio).toBe('Use a nomenclatura botânica (Gênero espécie), como Matricaria chamomilla L.');
    expect(MSG_PRESCRICAO.naoVegetal).toBe('Fórmula fitoterápica não pode ter vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II).');
  });
});
