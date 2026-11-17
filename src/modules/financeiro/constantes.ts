import type { FormaPagamento, TipoLancamento } from '@/db/schema/financeiro';
import type { Situacao } from './situacao';

export { FORMAS_DE_PAGAMENTO, type FormaPagamento } from '@/db/schema/financeiro';

/** RN-304: R$ 0,01 a R$ 1.000.000,00 (também o valor da consulta, RN-324). */
export const VALOR_MAX_CENTAVOS = 100_000_000;
/** RN-325: o saldo do caixa vai de −R$ 10.000.000,00 a R$ 10.000.000,00. */
export const SALDO_MAX_CENTAVOS = 1_000_000_000;
export const DESCRICAO_MAX = 200;
export const MOTIVO_MAX = 200;
export const NOME_CATEGORIA_MAX = 60;

/** Spec §6.2 (Formas), na ordem de `FORMAS_DE_PAGAMENTO`. */
export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  transferencia: 'Transferência bancária',
  boleto: 'Boleto',
  outra: 'Outra',
};

export type CategoriaInicial = { tipo: TipoLancamento; nome: string; chave: 'consultas' | null };

/** RN-302: as categorias semeadas na primeira gravação das Configurações, nesta ordem. "Consultas" é a da cobrança automática. */
export const CATEGORIAS_INICIAIS: readonly CategoriaInicial[] = [
  { tipo: 'entrada', nome: 'Consultas', chave: 'consultas' },
  { tipo: 'entrada', nome: 'Outras entradas', chave: null },
  ...[
    'Aluguel e condomínio',
    'Contas de consumo (água, luz, internet, telefone)',
    'Material e insumos',
    'Equipamentos',
    'Software e assinaturas',
    'Divulgação',
    'Impostos e taxas',
    'Conselho e associações',
    'Cursos e eventos',
    'Outras saídas',
  ].map((nome) => ({ tipo: 'saida' as const, nome, chave: null })),
];

/** Texto com um trecho que vira link na tela: `${antes}<a>${link}</a>${depois}`. */
type ComLink = { antes: string; link: string; depois: string };

const VALOR_FAIXA = 'O valor deve ser de R$ 0,01 a R$ 1.000.000,00.';
const VALOR_INVALIDO = 'Valor inválido. Use só números, como 250,00.';
const LINK_CONFIGURACOES = 'configurações do Financeiro';
const semValor = (inicio: string): ComLink => ({
  antes: `${inicio} A cobrança não foi criada: informe o valor da consulta nas `,
  link: LINK_CONFIGURACOES,
  depois: '.',
});
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * RN-328: os textos de interface do Financeiro (spec §6.2), chave por chave. Valores e datas chegam já formatados
 * (`formatarReais`, `formatarData`); "{n} paciente(s)" e "{n} cobrança(s)" saem no singular ou no plural.
 */
export const MSG_FINANCEIRO = {
  menu: 'Financeiro',
  secoes: { resumo: 'Resumo', lancamentos: 'Lançamentos', pendentes: 'Pagamentos pendentes', relatorios: 'Relatórios', configuracoes: 'Configurações' },
  comecePorAqui: 'Comece por aqui',
  comeceTexto:
    'Informe quanto há no caixa do consultório numa data e o valor da sua consulta. Depois disso, cada consulta marcada como Realizada gera a cobrança sozinha.',
  configurar: 'Configurar o Financeiro',
  semValorConsulta: 'O valor da consulta não está configurado: as consultas marcadas como Realizada não geram cobrança.',
  informarValor: 'Informar o valor da consulta',
  informeSaldo: 'Informe o saldo do caixa para começar.',

  // Resumo (US-305)
  cartaoSaldo: { titulo: 'Saldo atual', desde: (data: string) => `Desde o saldo de ${data}` },
  cartaoEntradas: {
    titulo: (mes: string) => `Entradas de ${mes}`,
    recebido: (valor: string) => `Recebido ${valor}`,
    aReceber: (valor: string) => `A receber ${valor}`,
    /** Só quando > 0. */
    atrasoAnterior: (valor: string) => `Em atraso de meses anteriores ${valor}`,
  },
  cartaoSaidas: {
    titulo: (mes: string) => `Saídas de ${mes}`,
    pago: (valor: string) => `Pago ${valor}`,
    aPagar: (valor: string) => `A pagar ${valor}`,
    /** Só quando > 0. */
    atrasoAnterior: (valor: string) => `Em atraso de meses anteriores ${valor}`,
  },
  cartaoPendentes: {
    titulo: 'Pagamentos pendentes',
    resumo: (n: number, valor: string) => `${plural(n, 'paciente', 'pacientes')} · ${valor}`,
    ver: 'Ver',
    vazio: 'Nenhum',
  },
  ultimos: { titulo: 'Últimos lançamentos', verTodos: 'Ver todos os lançamentos', vazio: 'Nenhum lançamento ainda.' },
  novaEntrada: 'Nova entrada',
  novaSaida: 'Nova saída',

  // Formulário do lançamento (US-301, US-302)
  campos: {
    valor: 'Valor',
    categoria: 'Categoria',
    vencimento: 'Vencimento',
    paciente: 'Paciente (opcional)',
    /** Depois do nome do paciente arquivado no seletor. */
    arquivado: '(arquivado)',
    descricao: 'Descrição (opcional)',
    jaFoi: { entrada: 'Já foi recebido', saida: 'Já foi pago' } satisfies Record<TipoLancamento, string>,
    dataDoPagamento: { entrada: 'Data do recebimento', saida: 'Data do pagamento' } satisfies Record<TipoLancamento, string>,
    forma: 'Forma de pagamento',
  },
  ajudaDescricao: {
    entrada: 'Até 200 caracteres. Não escreva informações de saúde aqui.',
    saida: 'Até 200 caracteres. Não escreva informações de saúde nem nomes de pessoas.',
  } satisfies Record<TipoLancamento, string>,
  salvarEntrada: 'Salvar entrada',
  salvarSaida: 'Salvar saída',
  formas: ROTULO_FORMA,
  situacoes: { previsto: 'Previsto', em_atraso: 'Em atraso', recebido: 'Recebido', pago: 'Pago', cancelado: 'Cancelado' } satisfies Record<Situacao, string>,

  // Lista (US-302, RN-306)
  filtros: {
    mes: 'Mês',
    /** Só com o filtro de paciente. */
    todosOsMeses: 'Todos os meses',
    mesAnterior: 'Mês anterior',
    proximoMes: 'Próximo mês',
    mais200: 'Mostrando os 200 mais recentes. Escolha um mês para ver os outros.',
    tipo: 'Tipo',
    tipos: { todos: 'Todos', entrada: 'Entradas', saida: 'Saídas' },
    categoria: 'Categoria',
    situacao: 'Situação',
    situacoes: { todas: 'Todas', previsto: 'Previsto', em_atraso: 'Em atraso', recebido_ou_pago: 'Recebido ou pago', cancelado: 'Cancelado' },
    forma: 'Forma de pagamento',
    /** "Todas" de "Categoria" e de "Forma de pagamento". */
    todas: 'Todas',
    paciente: (nome: string) => `Paciente: ${nome}`,
    limpar: 'Limpar',
    filtrar: 'Filtrar',
  },
  /** Sem os cancelados; os mesmos critérios do Resumo. */
  totaisDaLista: {
    recebidoOuPago: (entradas: string, saidas: string, resultado: string) => `Recebido ou pago: entradas ${entradas} · saídas ${saidas} · resultado ${resultado}`,
    emAberto: (entradas: string, saidas: string) => `Em aberto: entradas ${entradas} · saídas ${saidas}`,
  },
  vazioDaLista: 'Nenhum lançamento neste filtro.',
  acoes: {
    editar: 'Editar',
    marcarPago: { entrada: 'Marcar como recebido', saida: 'Marcar como pago' } satisfies Record<TipoLancamento, string>,
    desfazer: { entrada: 'Desfazer recebimento', saida: 'Desfazer pagamento' } satisfies Record<TipoLancamento, string>,
    cancelar: 'Cancelar lançamento',
    motivo: 'Motivo do cancelamento',
    confirmarCancelamento: 'Confirmar cancelamento',
  },
  avisoCancelar: 'O lançamento cancelado não volta. Ele continua na lista, como Cancelado, e sai dos totais e do saldo.',
  /** `?ok=<chave>` na URL; a região `role="status"` mostra o texto. */
  ok: {
    salvo: 'Lançamento salvo.',
    recebido: 'Recebimento registrado.',
    pago: 'Pagamento registrado.',
    cancelado: 'Lançamento cancelado.',
    config: 'Configurações salvas.',
  },
  pendentesDoPacienteVazio: { texto: (nome: string) => `Nenhum pagamento pendente de ${nome}.`, voltar: 'Voltar aos pagamentos pendentes' },
  antesDoSaldo: (data: string) => `Este lançamento é anterior ao saldo do caixa (${data}) e não altera o saldo atual.`,

  /** `role="alert"`, junto do campo. */
  erros: {
    informeValor: 'Informe o valor.',
    valorFaixa: VALOR_FAIXA,
    escolhaCategoria: 'Escolha a categoria.',
    informeVencimento: 'Informe o vencimento.',
    dataInvalida: 'Data inválida.',
    recebimentoFuturo: 'A data do recebimento não pode ser depois de hoje.',
    pagamentoFuturo: 'A data do pagamento não pode ser depois de hoje.',
    escolhaForma: 'Escolha a forma de pagamento.',
    descricaoLonga: 'A descrição tem no máximo 200 caracteres.',
    informeMotivo: 'Informe o motivo do cancelamento.',
    motivoLongo: 'O motivo tem no máximo 200 caracteres.',
    cancelado: 'Este lançamento foi cancelado e não pode mais ser alterado.',
    anonimizado: 'Este lançamento foi anonimizado e não pode mais ser alterado.',
    bloqueadoNovo: 'Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele.',
    bloqueadoAlterar: 'Paciente bloqueado por pedido de exclusão: só é possível registrar o recebimento, reduzir o valor ou cancelar.',
    jaTemCobranca: 'Esta consulta já tem uma cobrança.',
    periodoLongo: 'Escolha um período de até 12 meses.',
    valorInvalido: VALOR_INVALIDO,
  },
  errosConfig: {
    saldoFaixa: 'O saldo deve ser de −R$ 10.000.000,00 a R$ 10.000.000,00.',
    saldoFuturo: 'A data do saldo não pode ser depois de hoje.',
    informeDataSaldo: 'Informe a data do saldo.',
    informeValorSaldo: 'Informe o valor do saldo.',
    valorConsultaFaixa: VALOR_FAIXA,
    valorInvalido: VALOR_INVALIDO,
  },

  // Tela da consulta (US-303, RN-310, RN-312, RN-314)
  consulta: {
    titulo: 'Cobrança',
    valorESituacao: (valor: string, situacao: string) => `${valor} · ${situacao}`,
    recebidoEm: (data: string, forma: string) => `Recebido em ${data} · ${forma}`,
    salvarValor: 'Salvar valor',
    abrir: 'Abrir no Financeiro',
    semCobranca: 'Esta consulta não tem cobrança.',
    registrar: 'Registrar cobrança',
    /** "Configure o Financeiro" é link para /painel/financeiro/configuracoes. */
    configure: { link: 'Configure o Financeiro', depois: ' para registrar cobranças.' },
    bloqueado: 'Paciente bloqueado por pedido de exclusão: não é possível registrar cobrança nova.',
  },
  /** Depois de "Realizada"/"Faltou" (`?ok=presenca&cobranca=…`). */
  presenca: {
    criada: (valor: string) => `Presença registrada. Cobrança de ${valor} criada no Financeiro.`,
    semValor: semValor('Presença registrada.'),
    aberta: 'Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar.',
    recebida: 'Presença registrada. Esta consulta tem um pagamento recebido. Se for devolver o valor, cancele o lançamento no Financeiro.',
  },
  /** Depois de "Registrar atendimento" ligado a consulta; bloqueado ou já existia: sem mensagem do Financeiro. */
  atendimento: {
    criada: (valor: string) => `Atendimento registrado. Cobrança de ${valor} criada no Financeiro.`,
    semValor: semValor('Atendimento registrado.'),
  },
  /** Na edição do lançamento ligado a consulta (link para a consulta). */
  cobrancaDaConsulta: (data: string, hora: string) => `Cobrança da consulta de ${data}, ${hora}`,

  // Pagamentos pendentes (US-304)
  pendentesIntro: 'Cobranças de pacientes ainda não recebidas. Esta lista é só sua: nada é enviado ao paciente.',
  pendentes: {
    linha: (nome: string, valor: string, n: number, desde: string) => `${nome} · ${valor} · ${plural(n, 'cobrança', 'cobranças')} · desde ${desde}`,
    emAtraso: 'Em atraso',
    ver: 'Ver',
    vazio: 'Nenhum pagamento pendente.',
  },
  pendentesDoPaciente: {
    titulo: (nome: string) => `Pagamentos pendentes de ${nome}`,
    verTodos: (nome: string) => `Ver todos os lançamentos de ${nome}`,
  },
  bloqueado: 'Paciente bloqueado por pedido de exclusão. As cobranças em aberto continuam valendo; não é possível criar cobranças novas.',

  // Relatórios (US-306)
  relatorios: {
    ano: 'Ano',
    fluxo: (ano: number) => `Fluxo de caixa de ${ano}`,
    linhas: {
      saldoInicio: 'Saldo no início do mês',
      totalEntradas: 'Total de entradas',
      totalSaidas: 'Total de saídas',
      resultado: 'Resultado do mês',
      saldoFim: 'Saldo no fim do mês',
    },
    total: 'Total',
    notaSaldo: (data: string) => `O saldo começa em ${data}. Antes dessa data, só as entradas e as saídas aparecem.`,
    soPagos: 'Só entram os lançamentos recebidos ou pagos.',
    dozeMeses: 'Entradas e saídas nos últimos 12 meses',
    colunas: { mes: 'Mês', entradas: 'Entradas', saidas: 'Saídas', resultado: 'Resultado' },
  },
  csv: {
    baixar: 'Baixar CSV',
    de: 'De',
    ate: 'Até',
    incluirPacientes: 'Incluir o nome dos pacientes',
    ajuda:
      'Sem esta opção, o arquivo não tem a coluna Paciente, e a descrição das entradas de pacientes sai vazia. Com ela, o download fica registrado no Histórico de acessos de cada paciente. Quem receber o arquivo deve guardar sigilo.',
    /** Cabeçalho da RN-321 ("Paciente" só com a opção). */
    colunas: {
      vencimento: 'Vencimento',
      pagamento: 'Pagamento',
      tipo: 'Tipo',
      categoria: 'Categoria',
      descricao: 'Descrição',
      paciente: 'Paciente',
      forma: 'Forma de pagamento',
      valor: 'Valor',
      situacao: 'Situação',
    },
    /** Coluna "Tipo" do arquivo (o singular dos filtros "Entradas"/"Saídas"). */
    tipos: { entrada: 'Entrada', saida: 'Saída' } satisfies Record<TipoLancamento, string>,
  },

  // Configurações (US-300)
  configuracoes: {
    saldo: 'Saldo do caixa',
    dataSaldo: 'Data do saldo',
    valorSaldo: 'Valor do saldo',
    ajudaSaldo: 'O saldo atual soma a este valor tudo o que foi recebido e pago a partir desta data.',
    valorConsulta: 'Valor da consulta',
    ajudaValorConsulta: 'Sugerido em toda cobrança criada ao marcar a consulta como Realizada. Você pode mudar o valor em cada cobrança.',
    categorias: 'Categorias',
    entradas: 'Entradas',
    saidas: 'Saídas',
    novaCategoria: 'Nova categoria',
    renomear: 'Renomear',
    arquivar: 'Arquivar',
    reativar: 'Reativar',
    excluir: 'Excluir',
    arquivada: 'Arquivada',
    salvar: 'Salvar',
  },
  errosCategoria: {
    nomeRepetido: 'Já existe uma categoria com este nome.',
    nomeTamanho: 'O nome tem de 1 a 60 caracteres.',
    comLancamentos: 'Esta categoria tem lançamentos e não pode ser excluída. Arquive-a para que não apareça nos formulários.',
    consultasFixa: 'A categoria Consultas é usada nas cobranças das consultas e não pode ser arquivada. Você pode mudar o nome dela.',
  },

  /**
   * Textos que a spec §6.2 põe em outros arquivos (privacidade do painel, `CONFIRMAR_EXCLUSAO` do portal, e-mails
   * `pedido_exclusao_registrado` e `exclusao_atendida`, `DPA_O_QUE_MUDOU`): ficam aqui como referência exata para as
   * tarefas que os aplicam (US-307, US-309).
   */
  lgpd: {
    privacidadePainel: 'Os registros de pagamento do Financeiro ficam guardados pelo mesmo prazo do prontuário, e as cobranças em aberto continuam valendo.',
    confirmarExclusaoPortal:
      'Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico e os registros de pagamento das consultas são guardados pelo prazo legal.',
    emailPedidoExclusao:
      'Por obrigação legal, o prontuário clínico é guardado de forma bloqueada pelo prazo exigido, e os registros de pagamento das consultas ficam guardados pelo mesmo prazo (os pagamentos em aberto continuam devidos); o resto é apagado quando o pedido for atendido. Você recebe outro e-mail nesse momento.',
    emailExclusaoAtendida:
      'Se você tem registros de pagamento de consultas neste acompanhamento, eles ficam guardados pelo mesmo prazo, pelas obrigações fiscais, e os pagamentos em aberto continuam devidos.',
    dpaOQueMudou: 'O que mudou: o contrato passa a citar os registros financeiros do consultório, inclusive os pagamentos dos pacientes (Financeiro).',
  },
} as const;
