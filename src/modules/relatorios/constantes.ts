/**
 * Plano 26 (PD-100): as seções, os limites e os textos dos Relatórios (spec §6.2, chave por chave). Puro: as telas, o
 * CSV e a impressão leem daqui; nada de banco.
 */

/** RN-480: as seções, na ordem das abas. */
export const SECOES = ['pacientes', 'atendimentos', 'planos', 'agenda', 'financeiro', 'ranking'] as const;
export type Secao = (typeof SECOES)[number];

/** RN-492: o Ranking mostra até 20 pacientes. */
export const RANKING_LIMITE = 20;
/** RN-481: o período tem no máximo 12 meses. */
export const MESES_MAX = 12;

/** RN-492: os dois critérios do Ranking ("Mais consultas" / "Maior receita"). */
export const RANKING_POR = ['consultas', 'receita'] as const;
export type RankingPor = (typeof RANKING_POR)[number];

/**
 * RN-485 (RE-D6): faixas etárias dos pacientes ativos, em anos completos hoje. "Menos de 18" não existe no cadastro
 * (RN-17 do MVP) e só aparece com dado antigo, sem quebrar a tela. `max` nulo = sem teto.
 */
export const FAIXAS_ETARIAS: readonly { rotulo: string; min: number; max: number | null }[] = [
  { rotulo: 'Menos de 18', min: 0, max: 17 },
  { rotulo: '18 a 29', min: 18, max: 29 },
  { rotulo: '30 a 39', min: 30, max: 39 },
  { rotulo: '40 a 49', min: 40, max: 49 },
  { rotulo: '50 a 59', min: 50, max: 59 },
  { rotulo: '60 ou mais', min: 60, max: null },
];

/** Spec §6.2 (Relatórios). Valores e meses chegam já formatados (`periodo.ts`). */
export const MSG_RELATORIOS = {
  menu: 'Relatórios',
  titulo: 'Relatórios',
  /** Abas (§6.2) e o h2 de cada seção (§4.1: no Ranking, "Ranking de pacientes"). */
  abas: {
    pacientes: 'Pacientes',
    atendimentos: 'Atendimentos',
    planos: 'Planos alimentares',
    agenda: 'Agenda',
    financeiro: 'Financeiro',
    ranking: 'Ranking',
  } satisfies Record<Secao, string>,
  titulosDaSecao: {
    pacientes: 'Pacientes',
    atendimentos: 'Atendimentos',
    planos: 'Planos alimentares',
    agenda: 'Agenda',
    financeiro: 'Financeiro',
    ranking: 'Ranking de pacientes',
  } satisfies Record<Secao, string>,
  navAbas: 'Seções dos relatórios',

  filtros: {
    de: 'De',
    ate: 'Até',
    local: 'Local',
    todosOsLocais: 'Todos os locais',
    aplicar: 'Aplicar',
    baixarCsv: 'Baixar CSV',
    verImpressao: 'Ver versão para imprimir',
    mostrando: (de: string, ate: string) => `Mostrando ${de} a ${ate}.`,
  },
  erros: {
    ordem: 'O mês inicial não pode ser depois do final.',
    longo: 'Escolha um período de até 12 meses.',
    invalido: 'Período inválido. Mostrando os últimos 12 meses.',
  },
  vazio: 'Ainda não há dados neste período.',

  pacientes: {
    titulos: {
      situacao: 'Pacientes por situação',
      sexo: 'Pacientes ativos por sexo',
      fase: 'Pacientes ativos por fase da vida',
      novos: 'Novos pacientes por mês',
    },
    linhas: {
      ativos: 'Ativos',
      arquivados: 'Inativos (arquivados)',
      bloqueados: 'Bloqueados por pedido de exclusão',
      total: 'Total',
      feminino: 'Feminino',
      masculino: 'Masculino',
      naoInformado: 'Não informado',
      adultos: 'Adultos (18 a 59 anos)',
      idosos: 'Pessoas idosas (60 anos ou mais)',
      semNascimento: 'Sem data de nascimento',
      menosDe18: 'Menos de 18',
    },
    notas: {
      anonimizados: 'Pacientes anonimizados não entram nestes números.',
      arredondados: 'Os percentuais são arredondados.',
      local: 'Pacientes com consulta neste local no período. Sem o filtro, a contagem é de todos os pacientes.',
      recepcao: 'Pacientes bloqueados por pedido de exclusão e anonimizados não entram nos números da recepção.',
    },
  },

  atendimentos: {
    colunas: {
      mes: 'Mês',
      atendidos: 'Pacientes atendidos',
      novos: 'Pacientes novos (primeiro atendimento)',
      retorno: 'Pacientes em retorno',
      consultasRealizadas: 'Consultas realizadas',
      atendimentosRegistrados: 'Atendimentos registrados',
    },
    notas: {
      umaVez: 'Cada paciente conta uma vez por mês.',
      retorno: 'Retorno: o paciente já tinha consulta realizada ou atendimento antes do mês.',
      local: 'Atendimentos registrados sem consulta marcada não têm local e ficam fora deste filtro.',
    },
  },

  planos: {
    colunas: { mes: 'Mês', publicacoes: 'Publicações de plano', pacientes: 'Pacientes com plano publicado no mês' },
    cartaoHoje: (n: number, total: number) => `Pacientes ativos com plano publicado hoje: ${n} de ${total}`,
    notas: {
      publicacoes: 'Cada publicação conta, inclusive uma nova versão do mesmo plano. Modelos não entram.',
      semLocal: 'O filtro de local não se aplica aos planos alimentares.',
    },
  },

  agenda: {
    colunas: {
      mes: 'Mês',
      marcadas: 'Marcadas',
      realizadas: 'Realizadas',
      faltas: 'Faltas',
      taxa: 'Taxa de faltas',
      canceladasPaciente: 'Canceladas pelo paciente',
      canceladasConsultorio: 'Canceladas pelo consultório',
      marcadasPeloPaciente: 'Marcadas pelo paciente',
      retornos: 'Retornos',
      // Plano 23 na main (T11a)
      retornosPrevistos: 'Retornos previstos',
      previstosComConsulta: 'Previstos com consulta marcada',
    },
    notaTaxa: 'Taxa de faltas: faltas sobre as consultas não canceladas que já começaram, como no Início.',
  },

  financeiro: {
    colunas: { mes: 'Mês', recebido: 'Recebido', pago: 'Pago', resultado: 'Resultado' },
    porCategoria: 'Por categoria',
    linkFluxo: 'Fluxo de caixa do ano e CSV dos lançamentos',
    naoConfigurado: 'O Financeiro ainda não foi configurado.',
    configurar: 'Configurar o Financeiro',
    peca: 'Peça à nutricionista para configurar o Financeiro.',
    saidasSemLocal: 'Saídas não têm local.',
  },

  ranking: {
    por: { consultas: 'Mais consultas', receita: 'Maior receita' } satisfies Record<RankingPor, string>,
    titulos: {
      consultas: 'Pacientes com mais consultas realizadas',
      receita: 'Pacientes com maior receita recebida',
    } satisfies Record<RankingPor, string>,
    colunas: {
      posicao: 'Posição',
      paciente: 'Paciente',
      pacienteRegistro: 'Paciente (nome de registro)',
      consultas: 'Consultas',
      receita: 'Recebido',
    },
    aviso: "Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos.",
  },

  impressao: {
    titulo: (secao: string) => `Relatório de ${secao}`,
    tituloDaAba: (secao: string, consultorio: string) => `Relatório de ${secao} — ${consultorio}`,
    periodo: (de: string, ate: string) => `Período: ${de} a ${ate}`,
    local: (nome: string) => `Local: ${nome}`,
    localTodos: 'Local: Todos',
    geradoEm: (data: string, hora: string) => `Gerado em ${data} às ${hora}`,
    rodape: 'Documento interno do consultório, com dados de pacientes. Guarde com sigilo.',
    imprimir: 'Imprimir ou salvar em PDF',
    voltar: 'Voltar aos relatórios',
  },

  /**
   * Cabeçalhos do CSV que a §6.2 não fixa (a tabela da tela tem o número e o percentual sem título de coluna; a de novos
   * por mês, "Novos" no esboço da §7.1). Desvio registrado na T1.
   */
  csv: { pacientes: 'Pacientes', percentual: 'Percentual', novos: 'Novos', categoria: 'Categoria' },
} as const;
