import { describe, expect, it } from 'vitest';
import { exigirSecao, podeVerSecao, RelatorioSemPermissaoError, secoesPermitidas, type Acesso } from './acesso';
import { SECOES, type Secao } from './constantes';

const NUTRI: Acesso = { papel: 'nutri', financeiro: true };
const NUTRI_SEM_FLAG: Acesso = { papel: 'nutri', financeiro: false };
const RECEPCAO: Acesso = { papel: 'recepcao', financeiro: false };
const RECEPCAO_FIN: Acesso = { papel: 'recepcao', financeiro: true };

/**
 * RN-480: tabela exaustiva (o `Record<Secao, …>` quebra o typecheck se uma seção nova ficar sem decisão). Nutricionista:
 * todas. Recepção: Pacientes e Agenda; Financeiro só com a permissão; nunca Atendimentos, Planos alimentares e Ranking.
 */
const ESPERADO: Record<Secao, { nutri: boolean; recepcao: boolean; recepcaoFinanceiro: boolean }> = {
  pacientes: { nutri: true, recepcao: true, recepcaoFinanceiro: true },
  atendimentos: { nutri: true, recepcao: false, recepcaoFinanceiro: false },
  planos: { nutri: true, recepcao: false, recepcaoFinanceiro: false },
  agenda: { nutri: true, recepcao: true, recepcaoFinanceiro: true },
  financeiro: { nutri: true, recepcao: false, recepcaoFinanceiro: true },
  ranking: { nutri: true, recepcao: false, recepcaoFinanceiro: false },
};

describe('acesso às seções dos Relatórios (RN-480)', () => {
  it('a tabela cobre as seis seções, na ordem das abas', () => {
    expect(Object.keys(ESPERADO)).toEqual([...SECOES]);
  });

  for (const s of SECOES) {
    it(`${s}: nutricionista ${ESPERADO[s].nutri ? 'vê' : 'não vê'}; recepção ${ESPERADO[s].recepcao ? 'vê' : 'não vê'}; recepção com o Financeiro ${ESPERADO[s].recepcaoFinanceiro ? 'vê' : 'não vê'}`, () => {
      expect(podeVerSecao(NUTRI, s)).toBe(ESPERADO[s].nutri);
      expect(podeVerSecao(NUTRI_SEM_FLAG, s)).toBe(ESPERADO[s].nutri); // a permissão do Financeiro é só da recepção
      expect(podeVerSecao(RECEPCAO, s)).toBe(ESPERADO[s].recepcao);
      expect(podeVerSecao(RECEPCAO_FIN, s)).toBe(ESPERADO[s].recepcaoFinanceiro);
    });
  }

  it('secoesPermitidas devolve as abas na ordem, só as que o papel vê', () => {
    expect(secoesPermitidas(NUTRI)).toEqual(['pacientes', 'atendimentos', 'planos', 'agenda', 'financeiro', 'ranking']);
    expect(secoesPermitidas(NUTRI_SEM_FLAG)).toEqual(['pacientes', 'atendimentos', 'planos', 'agenda', 'financeiro', 'ranking']);
    expect(secoesPermitidas(RECEPCAO)).toEqual(['pacientes', 'agenda']);
    expect(secoesPermitidas(RECEPCAO_FIN)).toEqual(['pacientes', 'agenda', 'financeiro']);
  });

  it('a recepção nunca tem Ranking, Atendimentos nem Planos alimentares, com ou sem a permissão (RE-D36)', () => {
    for (const a of [RECEPCAO, RECEPCAO_FIN]) {
      for (const s of ['ranking', 'atendimentos', 'planos'] as const) expect(secoesPermitidas(a)).not.toContain(s);
    }
  });

  it('papel desconhecido (vindo de fora do tipo) não vê nada: falha fechada', () => {
    const estranho = { papel: 'paciente', financeiro: true } as unknown as Acesso;
    expect(secoesPermitidas(estranho)).toEqual([]);
    for (const s of SECOES) expect(podeVerSecao(estranho, s)).toBe(false);
  });

  it('seção desconhecida (texto da URL) não é permitida', () => {
    expect(podeVerSecao(NUTRI, 'qualquer' as Secao)).toBe(false);
  });
});

describe('exigirSecao (T2: antes de abrir a transação)', () => {
  it('a nutricionista passa em todas as seções', () => {
    for (const s of SECOES) expect(() => exigirSecao({ role: 'nutri' }, NUTRI, s)).not.toThrow();
  });

  it('a recepção é recusada nas seções que não vê (RN-480) e passa nas que vê', () => {
    expect(() => exigirSecao({ role: 'recepcao' }, RECEPCAO, 'pacientes')).not.toThrow();
    expect(() => exigirSecao({ role: 'recepcao' }, RECEPCAO, 'agenda')).not.toThrow();
    expect(() => exigirSecao({ role: 'recepcao' }, RECEPCAO_FIN, 'financeiro')).not.toThrow();
    for (const s of ['atendimentos', 'planos', 'ranking', 'financeiro'] as const) {
      expect(() => exigirSecao({ role: 'recepcao' }, RECEPCAO, s)).toThrow(RelatorioSemPermissaoError);
    }
  });

  it('contexto de outro papel nunca lê, nem com um acesso de nutricionista (worker, paciente, público)', () => {
    for (const role of ['worker', 'paciente', 'publico', 'recepcao']) {
      expect(() => exigirSecao({ role }, NUTRI, 'pacientes')).toThrow(RelatorioSemPermissaoError);
    }
    // a recepção com um acesso de nutricionista também não (o acesso tem de ser o da sessão)
    expect(() => exigirSecao({ role: 'nutri' }, RECEPCAO, 'pacientes')).toThrow(RelatorioSemPermissaoError);
  });

  it('a mensagem só tem a seção (RN-497)', () => {
    try {
      exigirSecao({ role: 'worker' }, NUTRI, 'ranking');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe('relatorios: seção ranking não permitida');
      expect((e as RelatorioSemPermissaoError).secao).toBe('ranking');
    }
  });
});
