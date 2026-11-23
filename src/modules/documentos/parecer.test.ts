import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DECLARACAO_PARECER, DECLARACAO_POR_TIPO, DECLARACAO_RECEITA, DECLARACAO_SOLICITACAO, linhaDaVersao, MSG_RETIFICACAO, RESSALVA_PARECER, rotuloDaVersao, TIPO_DOCUMENTO_COM_ARTIGO, TIPO_DOCUMENTO_ROTULO } from './constantes';
import { DocumentoError } from './erros';
import { linhaDoValor, mesmoExame, MSG_PARECER, rotuloDoExame, validarParecerParaPreparar, validarRascunhoParecer, type ConteudoParecer, type ExameCopiado } from './parecer';

const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
/** O erro lançado (o teste falha se nada for lançado). */
const erroDe = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('não lançou');
};
const exame = (o: Partial<ExameCopiado> = {}): ExameCopiado => ({ id: randomUUID(), data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }], ...o });
const parecer = (o: Partial<ConteudoParecer> = {}): ConteudoParecer => ({ versao: 1, tipo: 'parecer', exames: [exame()], avaliacao: 'Marcadores compatíveis com baixa reserva de ferro.', conduta: '', encaminhamentos: '', ...o });

describe('textos do parecer e da retificação (spec v0.5, D5, US-148, Q13-5)', () => {
  it('rótulos, declaração e ressalva (D5, rascunho até a Debby e o CRN-3)', () => {
    // Plano 22 (RN-397): + a solicitação de exames laboratoriais
    expect(TIPO_DOCUMENTO_ROTULO).toEqual({ receita: 'Receita', parecer: 'Parecer nutricional', solicitacao_exames: 'Solicitação de exames laboratoriais' });
    expect(TIPO_DOCUMENTO_COM_ARTIGO).toEqual({ receita: 'da receita', parecer: 'do parecer nutricional', solicitacao_exames: 'da solicitação de exames laboratoriais' });
    expect(DECLARACAO_PARECER).toBe('Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.');
    expect(RESSALVA_PARECER).toBe('Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica.');
    expect(DECLARACAO_POR_TIPO).toEqual({ receita: DECLARACAO_RECEITA, parecer: DECLARACAO_PARECER, solicitacao_exames: DECLARACAO_SOLICITACAO });
    expect(rotuloDaVersao(2)).toBe('Versão 2');
    expect(linhaDaVersao(2, 'ABCD-EFGH-JKMN')).toBe('Versão 2 — substitui o documento ABCD-EFGH-JKMN');
    expect(MSG_RETIFICACAO.motivo).toBe('Escreva o motivo da retificação (até 500 caracteres).');
    expect(MSG_RETIFICACAO.emAndamento(2)).toBe('Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar.');
  });

  it('linhas do exame e do valor (PDF e painel); sem a origem da IA (Q13-2 ★)', () => {
    expect(rotuloDoExame({ titulo: 'Hemograma', data: '2026-09-01' })).toBe('Hemograma — 01/09/2026');
    expect(linhaDoValor({ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: randomUUID() })).toBe('Ferritina · 12 · ng/mL · —');
    expect(linhaDoValor({ nome: 'Glicose', valor: 92.5, unidade: null, referencia: '70 a 99' })).toBe('Glicose · 92,5 · — · 70 a 99');
    expect(MSG_PARECER.exameExcluidoDepois('Hemograma — 01/09/2026')).toBe('O exame Hemograma — 01/09/2026 foi excluído depois do parecer.');
  });
});

describe('validarRascunhoParecer (US-141, D-P4)', () => {
  it('aceita o rascunho incompleto; tira ids repetidos; normaliza a quebra de linha do navegador (\\r\\n) antes de contar', () => {
    const id = randomUUID();
    expect(validarRascunhoParecer({})).toEqual({ exameIds: [], avaliacao: '', conduta: '', encaminhamentos: '' });
    const r = validarRascunhoParecer({ exameIds: [id, id], avaliacao: `  a\r\nb  `, conduta: 'c', encaminhamentos: 'e' });
    expect(r).toEqual({ exameIds: [id], avaliacao: 'a\nb', conduta: 'c', encaminhamentos: 'e' });
    // 2499 × "x\n" (4998) + "xx" = 5000 depois da troca do \r\n: cabe
    expect(() => validarRascunhoParecer({ avaliacao: 'x\r\n'.repeat(2499) + 'xx' })).not.toThrow();
  });

  it('os máximos valem no salvar: 20 exames, 5000/5000/1000 caracteres; id que não é uuid = exame que não existe', () => {
    expect(erroDe(() => validarRascunhoParecer({ exameIds: Array.from({ length: 21 }, () => randomUUID()) }))).toSatisfy(erroEm('exames', MSG_PARECER.examesDemais));
    const e = erroDe(() => validarRascunhoParecer({ avaliacao: 'x'.repeat(5001), conduta: 'x'.repeat(5001), encaminhamentos: 'x'.repeat(1001), exameIds: ['1; drop table exams'] }));
    expect(e).toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    expect(e).toSatisfy(erroEm('conduta', 'Use no máximo 5000 caracteres.'));
    expect(e).toSatisfy(erroEm('encaminhamentos', 'Use no máximo 1000 caracteres.'));
    expect(e).toSatisfy(erroEm('exames', 'Um dos exames selecionados foi excluído. Revise a seleção.'));
  });
});

describe('validarParecerParaPreparar (US-141, RN-148)', () => {
  it('exige ao menos um exame e a avaliação; aceita conduta e encaminhamentos vazios', () => {
    expect(erroDe(() => validarParecerParaPreparar(parecer({ exames: [] })))).toSatisfy(erroEm('exames', 'Selecione ao menos um exame.'));
    expect(erroDe(() => validarParecerParaPreparar(parecer({ avaliacao: '   ' })))).toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    expect(() => validarParecerParaPreparar(parecer())).not.toThrow();
  });
});

describe('mesmoExame (RN-148 v0.5: título, data e linhas; a origem não conta)', () => {
  it('igual; linha acrescentada (IA); data trocada; título trocado; valor diferente', () => {
    const e = exame();
    expect(mesmoExame(e, { ...e, valores: e.valores.map((v) => ({ ...v, iaTarefaId: randomUUID() })) })).toBe(true);
    expect(mesmoExame(e, { ...e, valores: [...e.valores, { nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null }] })).toBe(false);
    expect(mesmoExame(e, { ...e, data: '2026-09-02' })).toBe(false);
    expect(mesmoExame(e, { ...e, titulo: 'Hemograma completo' })).toBe(false);
    expect(mesmoExame(e, { ...e, valores: [{ ...e.valores[0], valor: 13.6 }] })).toBe(false);
  });
});
