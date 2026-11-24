import { describe, expect, it } from 'vitest';
import { DocumentoError } from './erros';
import { binomioValido, descreverItem, exigeHabilitacao, MSG_PRESCRICAO, TERMOS_NAO_VEGETAIS, temTermoNaoVegetal, TIPOS_ITEM, validarItem, validarItensDoModelo, validarParaPreparar, validarRascunho } from './prescricao';

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
  it('TERMOS_NAO_VEGETAIS (revisão final do PR 1): própolis, geleia real, quitosana, glucosamina, condroitina, inositol, ubiquinol, licopeno e luteína, com e sem acento; "Coenzima Q10" pela palavra "coenzima" (sem entrada redundante)', () => {
    for (const t of ['própolis', 'geleia real', 'quitosana', 'glucosamina', 'condroitina', 'inositol', 'ubiquinol', 'licopeno', 'luteína']) expect(TERMOS_NAO_VEGETAIS, t).toContain(t);
    expect(TERMOS_NAO_VEGETAIS).not.toContain('coenzima Q10');
    for (const n of ['Própolis verde', 'extrato de propolis', 'Geleia real liofilizada', 'GELÉIA REAL', 'Quitosana', 'Glucosamina', 'Condroitina', 'Mio-inositol', 'Ubiquinol', 'Coenzima Q10', 'Licopeno', 'Luteina', 'luteína e zeaxantina']) {
      expect(temTermoNaoVegetal(n), n).toBe(true);
    }
    for (const n of ['Geleia de frutas', 'Real', 'Matricaria chamomilla L.']) expect(temTermoNaoVegetal(n), n).toBe(false);
  });
  it('fitoterapico (Res. CFN 680/2021, art. 9º, II; /code-review do PR 1): só a nomenclatura com termo não vegetal é recusada com naoVegetal; extração e padronização ficam de fora', () => {
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' };
    expect(lanca('itens.0.nomenclatura', MSG_PRESCRICAO.naoVegetal)(() => validarRascunho({ itens: [{ ...fito, nomenclatura: 'Picolinato de cromo' }] }, { habilitada: true }))).toBe(true);
    expect(lanca('itens.0.nomenclatura', MSG_PRESCRICAO.naoVegetal)(() => validarRascunho({ itens: [{ ...fito, nomenclatura: 'Curcumina isolada' }] }, { habilitada: true }))).toBe(true);
    // o marcador de padronização na extração é legítimo (rascunho e retificação já salvos continuam valendo)
    const curcuma = { ...fito, nomenclatura: 'Curcuma longa L.', parte: 'Rizoma', extracao: 'Extrato seco padronizado a 95% de curcumina' };
    expect(validarRascunho({ itens: [curcuma] }, { habilitada: true }).itens).toEqual([expect.objectContaining({ extracao: 'Extrato seco padronizado a 95% de curcumina' })]);
    expect(validarRascunho({ itens: [{ ...fito, padronizacao: '3,5% de vitexina; ácido valerênico 0,8%' }] }, { habilitada: true }).itens).toHaveLength(1);
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

/** Plano 22 (T9, US-378): a fórmula magistral fitoterápica com 3 compostos, como no cenário da spec. */
const composto = (nomenclatura: string, extra: Record<string, unknown> = {}) => ({ nomenclatura, parte: 'Folhas', extracao: 'Extrato seco', quantidade: '200', unidade: 'mg', ...extra });
const formula = (compostos: unknown[] = [composto('Passiflora incarnata L.'), composto('Melissa officinalis L.'), composto('Matricaria chamomilla L.', { parte: 'Flores', padronizacao: '1,2% de apigenina' })]) => ({
  tipo: 'formula_fitoterapica', compostos, formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1 cápsula à noite', duracao: '30 dias',
});

describe('Plano 22 (T9): fórmula magistral fitoterápica no Zod do item (RN-392, US-378)', () => {
  it('o rótulo novo em TIPOS_ITEM; o do fitoterápico (spec 10A) não muda; a ajuda do seletor do tipo com o texto da §6.2', () => {
    expect(TIPOS_ITEM.formula_fitoterapica).toBe('Fórmula magistral com vários compostos vegetais');
    expect(TIPOS_ITEM.fitoterapico).toBe('Fitoterápico (forma farmacêutica ou fórmula magistral)');
    expect(MSG_PRESCRICAO.ajudaTipo).toBe("Use 'Fórmula magistral com vários compostos vegetais' quando a fórmula tiver de 2 a 10 derivados vegetais em quantidades próprias; 'Fitoterápico' para o produto de uma planta só.");
    // semHabilitacao e dicaOutro citam os dois tipos (§6.2)
    for (const m of [MSG_PRESCRICAO.semHabilitacao, MSG_PRESCRICAO.dicaOutro]) {
      expect(m).toContain(`"${TIPOS_ITEM.fitoterapico}"`);
      expect(m).toContain(`"${TIPOS_ITEM.formula_fitoterapica}"`);
    }
  });

  it('3 compostos com a habilitação: salvo, quantidades com vírgula viram número, padronização opcional', () => {
    const c = validarRascunho({ itens: [formula()] }, { habilitada: true });
    expect(c.itens[0]).toMatchObject({ tipo: 'formula_fitoterapica', compostos: [{ quantidade: 200, padronizacao: '' }, {}, { padronizacao: '1,2% de apigenina' }], via: 'oral', duracao: '30 dias' });
    expect(c.orientacoesFormato).toBe('marcacao');
  });

  it('sem a habilitação: recusada com semHabilitacao na chave do tipo (salvar e preparar)', () => {
    expect(lanca('itens.0.tipo', MSG_PRESCRICAO.semHabilitacao)(() => validarRascunho({ itens: [formula()] }, { habilitada: false }))).toBe(true);
    const c = validarRascunho({ itens: [formula()] }, { habilitada: true });
    expect(lanca('itens.0.tipo', MSG_PRESCRICAO.semHabilitacao)(() => validarParaPreparar(c, 'Insônia leve', { habilitada: false }))).toBe(true);
  });

  it('composto que não é vegetal (na nomenclatura) → naoVegetal; "camomila" → binomio', () => {
    for (const n of ['Picolinato de cromo', 'Vitamina C', 'Creatina monoidratada', 'Curcumina lipossomal', 'Lactobacillus acidophilus']) {
      const f = formula([composto('Passiflora incarnata L.'), composto(n)]);
      expect(lanca('itens.0.compostos.1.nomenclatura', MSG_PRESCRICAO.naoVegetal)(() => validarRascunho({ itens: [f] }, { habilitada: true })), n).toBe(true);
    }
    expect(lanca('itens.0.compostos.0.nomenclatura', MSG_PRESCRICAO.binomio)(() => validarRascunho({ itens: [formula([composto('camomila'), composto('Melissa officinalis L.')])] }, { habilitada: true }))).toBe(true);
  });

  it('RN-392 (ajuste do /code-review do PR 1): o "Derivado ou extração" e a padronização ficam fora da conferência — "curcumina isolada" e "5% de curcuminoides" passam', () => {
    const f = formula([composto('Curcuma longa L.', { parte: 'Rizoma', extracao: 'curcumina isolada', padronizacao: '5% de curcuminoides' }), composto('Zingiber officinale Roscoe', { parte: 'Rizoma', padronizacao: '5% de gingeróis' })]);
    expect(validarRascunho({ itens: [f] }, { habilitada: true }).itens[0]).toMatchObject({ compostos: [{ extracao: 'curcumina isolada', padronizacao: '5% de curcuminoides' }, {}] });
  });

  it('1 e 11 compostos → compostos; via só oral, sublingual ou enteral; posologia até 300', () => {
    expect(lanca('itens.0.compostos', MSG_PRESCRICAO.compostos)(() => validarRascunho({ itens: [formula([composto('Passiflora incarnata L.')])] }, { habilitada: true }))).toBe(true);
    expect(lanca('itens.0.compostos', MSG_PRESCRICAO.compostos)(() => validarRascunho({ itens: [formula(Array(11).fill(composto('Passiflora incarnata L.')))] }, { habilitada: true }))).toBe(true);
    expect(lanca('itens.0.compostos', MSG_PRESCRICAO.compostos)(() => validarRascunho({ itens: [{ ...formula(), compostos: undefined }] }, { habilitada: true }))).toBe(true);
    expect(() => validarRascunho({ itens: [{ ...formula(), via: 'retal' }] }, { habilitada: true })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...formula(), posologia: 'x'.repeat(301) }] }, { habilitada: true })).toThrow(DocumentoError);
    for (const v of ['oral', 'sublingual', 'enteral']) expect(validarRascunho({ itens: [{ ...formula(), via: v }] }, { habilitada: true }).itens).toHaveLength(1);
  });

  it('descreverItem: um composto por linha (nomenclatura, parte, derivado, padronização, quantidade), a forma, a via, a posologia e a duração', () => {
    const [it] = validarRascunho({ itens: [formula()] }, { habilitada: true }).itens;
    expect(descreverItem(it)).toEqual({
      titulo: 'Fórmula magistral fitoterápica',
      linhas: [
        'Passiflora incarnata L. · Folhas · Extrato seco · 200 mg',
        'Melissa officinalis L. · Folhas · Extrato seco · 200 mg',
        'Matricaria chamomilla L. · Flores · Extrato seco · Padronização: 1,2% de apigenina · 200 mg',
        'Forma farmacêutica: Cápsula',
        'Via: Oral',
        'Posologia: 1 cápsula à noite',
        'Duração: 30 dias',
      ],
    });
  });

  it('RN-395: o rascunho validado grava orientacoesFormato "marcacao" (também um rascunho antigo salvo de novo)', () => {
    expect(validarRascunho({ itens: [], orientacoes: '**Beba água**' }, { habilitada: false })).toEqual({ versao: 1, tipo: 'receita', itens: [], orientacoes: '**Beba água**', orientacoesFormato: 'marcacao' });
  });
});

describe('Plano 22 (T9, R22-09): validarItem e validarItensDoModelo — o mesmo Zod do item, para a T10a', () => {
  it('validarItem: fitoterápico (e a fórmula) sem habilitação → semHabilitacao na chave "tipo"; suplemento válido → o item', () => {
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' };
    expect(lanca('tipo', MSG_PRESCRICAO.semHabilitacao)(() => validarItem(fito, { habilitada: false }))).toBe(true);
    expect(lanca('tipo', MSG_PRESCRICAO.semHabilitacao)(() => validarItem(formula(), { habilitada: false }))).toBe(true);
    expect(validarItem(fito, { habilitada: true })).toMatchObject({ tipo: 'fitoterapico' });
    expect(validarItem(vitD, { habilitada: false })).toMatchObject({ tipo: 'suplemento', composicao: [{ quantidade: 2000 }] });
    // os erros do Zod sem o prefixo "itens.N"
    expect(lanca('posologia', 'Informe a posologia (até 300 caracteres).')(() => validarItem({ ...vitD, posologia: '' }, { habilitada: false }))).toBe(true);
    expect(() => validarItem(null, { habilitada: false })).toThrow(DocumentoError);
  });

  it('validarItensDoModelo: 0 itens → semItens; 21 → itensDemais; 3 → os itens, as orientações e orientacoesFormato "marcacao"; habilitação conferida', () => {
    expect(lanca('itens', MSG_PRESCRICAO.semItens)(() => validarItensDoModelo({ itens: [], orientacoes: '' }, { habilitada: false }))).toBe(true);
    expect(lanca('itens', MSG_PRESCRICAO.semItens)(() => validarItensDoModelo({ itens: undefined, orientacoes: '' }, { habilitada: false }))).toBe(true);
    expect(lanca('itens', MSG_PRESCRICAO.itensDemais)(() => validarItensDoModelo({ itens: Array(21).fill(vitD), orientacoes: '' }, { habilitada: false }))).toBe(true);
    expect(lanca('orientacoes', MSG_PRESCRICAO.orientacoes)(() => validarItensDoModelo({ itens: [vitD], orientacoes: 'x'.repeat(2001) }, { habilitada: false }))).toBe(true);
    const m = validarItensDoModelo({ itens: [vitD, curcuma, vitD], orientacoes: ' - Com água ' }, { habilitada: false });
    expect(m).toEqual({ itens: [expect.objectContaining({ tipo: 'suplemento' }), expect.objectContaining({ tipo: 'derivado_vegetal' }), expect.objectContaining({ tipo: 'suplemento' })], orientacoes: '- Com água', orientacoesFormato: 'marcacao' });
    expect(lanca('itens.1.tipo', MSG_PRESCRICAO.semHabilitacao)(() => validarItensDoModelo({ itens: [vitD, formula()], orientacoes: '' }, { habilitada: false }))).toBe(true);
  });
});
