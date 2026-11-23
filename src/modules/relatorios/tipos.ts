import type { RankingPor, Secao } from './constantes';

/**
 * Plano 26: o que cada seção dos Relatórios devolve (só números e rótulos; no Ranking, o id e os dois nomes — RN-492).
 * As funções de leitura (T2) preenchem; a tela, o CSV e a impressão só formatam. Meses 'AAAA-MM'; dinheiro em centavos.
 */

/** Uma linha de contagem com o rótulo da §6.2 ("Feminino", "18 a 29", …). */
export type LinhaContagem = { rotulo: string; n: number };

/**
 * US-480 (RN-483 a RN-487). `bloqueados` ausente na sessão da recepção (RE-D39). Sexo, fase e faixas contam os ativos
 * (o percentual é sobre `situacao.ativos`).
 */
export type RelPacientes = {
  situacao: { ativos: number; arquivados: number; bloqueados?: number; total: number };
  sexo: LinhaContagem[];
  fase: LinhaContagem[];
  faixas: LinhaContagem[];
  novosPorMes: { mes: string; n: number }[];
};

/** US-481 (RN-488). */
export type RelAtendimentos = {
  meses: { mes: string; atendidos: number; novos: number; retorno: number; consultasRealizadas: number; atendimentosRegistrados: number }[];
};

/** US-482 (RN-489). */
export type RelPlanos = {
  meses: { mes: string; publicacoes: number; pacientes: number }[];
  hoje: { comPlano: number; ativos: number };
};

/**
 * US-483 (RN-490). A taxa de faltas é `faltas / iniciadas` (não canceladas que já começaram), a conta do Início; sem
 * iniciada, sem taxa. As previsões só existem com o Plano 23 na `main` (T11a).
 */
export type LinhaAgenda = {
  mes: string;
  marcadas: number;
  realizadas: number;
  faltas: number;
  iniciadas: number;
  canceladasPaciente: number;
  canceladasConsultorio: number;
  marcadasPeloPaciente: number;
  retornos: number;
  retornosPrevistos?: number;
  previstosComConsulta?: number;
};
export type RelAgenda = { meses: LinhaAgenda[] };

/** US-484 (RN-491). `pago` nulo com o filtro de local ("Saídas não têm local."): o resultado também fica sem valor. */
export type RelFinanceiro =
  | { configurado: false }
  | {
      configurado: true;
      meses: { mes: string; recebido: number; pago: number | null }[];
      porCategoria: { entradas: { categoria: string; valor: number }[]; saidas: { categoria: string; valor: number }[] };
    };

/** US-485 (RN-492): na tela o nome exibido; no CSV e na impressão, o de registro. `valor` = consultas ou centavos. */
export type LinhaRanking = { patientId: string; nomeExibido: string; nomeRegistro: string; valor: number };
export type RelRanking = { por: RankingPor; linhas: LinhaRanking[] };

type Mapa = {
  pacientes: RelPacientes;
  atendimentos: RelAtendimentos;
  planos: RelPlanos;
  agenda: RelAgenda;
  financeiro: RelFinanceiro;
  ranking: RelRanking;
};
/** Os dados de cada seção (seção nova sem entrada em `Mapa` quebra o typecheck aqui). */
export type DadosDaSecao = { [S in Secao]: Mapa[S] };
