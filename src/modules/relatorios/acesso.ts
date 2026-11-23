import { SECOES, type Secao } from './constantes';

/**
 * RN-480: quem vê cada seção dos Relatórios — um lugar só para as abas, a página, o CSV e a impressão. Nutricionista:
 * todas. Recepção: Pacientes e Agenda e, com a permissão do Financeiro, Financeiro; nunca Atendimentos e Planos
 * alimentares (registros do prontuário) nem o Ranking (lista nominal, RE-D36). No PR 1 todas as rotas chamam
 * `requireNutri` (RE-D51); o papel `recepcao` já entra aqui para a T11b só trocar a sessão. Puro.
 */
export type Acesso = { papel: 'nutri' | 'recepcao'; financeiro: boolean };

const DA_RECEPCAO: readonly Secao[] = ['pacientes', 'agenda'];

/** As seções que o acesso vê, na ordem das abas. Papel fora do tipo (dado de fora) não vê nada: falha fechada. */
export function secoesPermitidas(a: Acesso): Secao[] {
  if (a.papel === 'nutri') return [...SECOES];
  if (a.papel === 'recepcao') return SECOES.filter((s) => DA_RECEPCAO.includes(s) || (s === 'financeiro' && a.financeiro === true));
  return [];
}

/** A seção pedida (às vezes texto da URL) está entre as permitidas? */
export function podeVerSecao(a: Acesso, s: Secao): boolean {
  return secoesPermitidas(a).includes(s);
}
