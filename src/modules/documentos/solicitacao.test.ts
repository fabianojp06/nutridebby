import { describe, expect, it } from 'vitest';
import { DECLARACAO_SOLICITACAO as DA_CONSTANTE } from './constantes';
import { DocumentoError } from './erros';
import { DECLARACAO_SOLICITACAO, MSG_SOLICITACAO, validarRascunhoSolicitacao, validarSolicitacaoParaPreparar } from './solicitacao';

function erroDe(f: () => unknown): Record<string, string> {
  try {
    f();
  } catch (e) {
    if (e instanceof DocumentoError) return e.erros;
    throw e;
  }
  return {};
}

describe('solicitação de exames (RN-388, RN-389; "Solicitação: erros" da §6.2)', () => {
  it('rascunho válido: indicação vazia vira null; orientacoesFormato sempre "marcacao"; 0 exames vale no rascunho', () => {
    expect(validarRascunhoSolicitacao({ exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }], indicacaoClinica: '  ', orientacoes: 'Jejum de **8 h**.\n- traga o pedido', orientacoesFormato: 'texto' })).toEqual({
      versao: 1,
      tipo: 'solicitacao_exames',
      exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }],
      indicacaoClinica: null,
      orientacoes: 'Jejum de **8 h**.\n- traga o pedido',
      orientacoesFormato: 'marcacao',
    });
    expect(validarRascunhoSolicitacao({})).toMatchObject({ exames: [], indicacaoClinica: null, orientacoes: '', orientacoesFormato: 'marcacao' });
    expect(validarRascunhoSolicitacao({ exames: [], indicacaoClinica: ' Acompanhar a resposta à dieta. ' }).indicacaoClinica).toBe('Acompanhar a resposta à dieta.');
  });

  it('sem chave de laboratório: chaves desconhecidas somem (sem .strict(), como a receita)', () => {
    const c = validarRascunhoSolicitacao({ exames: [{ nome: 'Glicose' }], laboratorio: 'Laboratório X', link: 'http://x', data: '2026-01-01' });
    expect(c).not.toHaveProperty('laboratorio');
    expect(c).not.toHaveProperty('link');
    expect(c).not.toHaveProperty('data');
    expect(Object.keys(c).sort()).toEqual(['exames', 'indicacaoClinica', 'orientacoes', 'orientacoesFormato', 'tipo', 'versao']);
  });

  it('as mensagens de "Solicitação: erros"', () => {
    const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ nome: `Exame ${i}` }));
    expect(Object.values(erroDe(() => validarRascunhoSolicitacao({ exames: lista(41) })))).toContain('A solicitação pode ter até 40 exames.');
    expect(Object.values(erroDe(() => validarRascunhoSolicitacao({ exames: [{ nome: '' }] })))).toContain('O nome do exame tem de 1 a 80 caracteres.');
    expect(Object.values(erroDe(() => validarRascunhoSolicitacao({ exames: [{ nome: 'Glicose' }, { nome: 'glicose' }] })))).toContain('Este exame já está na lista.');
    expect(erroDe(() => validarRascunhoSolicitacao({ indicacaoClinica: 'x'.repeat(501) })).indicacaoClinica).toBe('A indicação clínica tem no máximo 500 caracteres.');
    expect(erroDe(() => validarRascunhoSolicitacao({ orientacoes: 'x'.repeat(1001) })).orientacoes).toBe('As orientações têm no máximo 1000 caracteres.');
    expect(erroDe(() => validarSolicitacaoParaPreparar(validarRascunhoSolicitacao({}))).exames).toBe('Inclua ao menos um exame.');
    expect(() => validarSolicitacaoParaPreparar(validarRascunhoSolicitacao({ exames: [{ nome: 'Glicose' }] }))).not.toThrow();
    expect(MSG_SOLICITACAO.erros).toEqual({
      semExames: 'Inclua ao menos um exame.',
      max: 'A solicitação pode ter até 40 exames.',
      nome: 'O nome do exame tem de 1 a 80 caracteres.',
      repetido: 'Este exame já está na lista.',
      indicacao: 'A indicação clínica tem no máximo 500 caracteres.',
      orientacoes: 'As orientações têm no máximo 1000 caracteres.',
    });
  });

  it('NUL some do texto (o Postgres recusaria); as quebras de linha da marcação ficam', () => {
    const c = validarRascunhoSolicitacao({ indicacaoClinica: 'a\u0000b', orientacoes: 'linha 1\r\n\r\n- item\u0000' });
    expect(c.indicacaoClinica).toBe('ab');
    expect(c.orientacoes).toBe('linha 1\n\n- item');
  });

  it('textos da §6.2 e a declaração: a mesma de constantes.ts (reexportada, R22-14)', () => {
    expect(MSG_SOLICITACAO.titulo).toBe('Solicitação de exames laboratoriais');
    expect(MSG_SOLICITACAO.nova).toBe('Nova solicitação de exames');
    expect(MSG_SOLICITACAO.ajudaForaDoCatalogo).toBe('Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII).');
    expect(MSG_SOLICITACAO.confirmarSubstituir(3)).toBe('Substituir os 3 exames da solicitação pelos do modelo?');
    expect(MSG_SOLICITACAO.examesSolicitadosEm('12/11/2026')).toBe('Exames solicitados em 12/11/2026');
    expect(MSG_SOLICITACAO.avisoPlanos).toBe('Planos de saúde podem recusar pedido de exame feito por nutricionista.');
    expect(DECLARACAO_SOLICITACAO).toBe(DA_CONSTANTE);
    expect(DECLARACAO_SOLICITACAO).toBe(
      'Declaro que os exames solicitados são laboratoriais e necessários à avaliação, à prescrição ou à evolução nutricional, dentro da minha competência (Lei nº 8.234/1991, art. 4º, VIII, e Resolução CFN nº 306/2003), e que este pedido não indica laboratório.',
    );
  });
});
