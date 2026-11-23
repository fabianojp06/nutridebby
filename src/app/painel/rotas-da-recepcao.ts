/**
 * Plano 26 (RN-513, RE-D15, RE-D16): lista fechada do que a recepção abre no painel — negação por padrão no app. Só as
 * entradas daqui chamam `requireEquipe`/`requireApiEquipe` (src/lib/tenant-session.ts); todo o resto chama
 * `requireNutri`/`requireApiNutri`, que não mudam. Guarda de fonte: rotas-da-recepcao.test.ts (por página, rota da API e
 * cada action exportada de todo arquivo com 'use server').
 *
 * Formato: a rota da página (`/painel/ajuda`, segmentos dinâmicos como no arquivo: `/painel/cadastro/[id]`), a rota da
 * API (`/api/painel/relatorios/csv`) ou a action, pelo arquivo a partir de src/app e o nome
 * (`/painel/preferencias/actions.ts#alternarTemaAction`). Só acrescentar no fim (arquivo disputado com o PR 3).
 *
 * PR 2: o Início (a versão da recepção, T8), as telas de aviso, o manual e as duas actions de preferências do cabeçalho
 * (`escolherTemaAction`, das Configurações, continua só da nutricionista). O PR 3 acrescenta pacientes, cadastro, agenda,
 * Financeiro e Relatórios.
 */
export const ROTAS_DA_RECEPCAO: readonly string[] = [
  '/painel',
  '/painel/sem-permissao',
  '/painel/contrato-pendente',
  '/painel/ajuda',
  '/painel/preferencias/actions.ts#alternarTemaAction',
  '/painel/preferencias/actions.ts#marcarGuiaAction',
];

/**
 * RE-D67: fora do painel não há `requireEquipe`; estas rotas aceitam a recepção pela lista de papéis de
 * `requireUser`/`requireApiUser`/`lerSessaoApi` (guarda de fonte: src/app/papeis-fora-do-painel.test.ts, com a decisão de
 * cada arquivo de src/app fora do painel). A regra "toda entrada chama requireEquipe" não vale aqui.
 */
export const FORA_DO_PAINEL: readonly string[] = ['/conta/seguranca', '/conta/acesso-desativado', '/inicio', '/conta/outro-papel', '/api/sessao/ativa'];
