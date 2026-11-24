import type { TipoDeLocal } from '@/db/schema';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import type { Modalidade, ModalidadeRegra } from './horarios';

export const DURACAO_MIN = 15;
export const DURACAO_MAX = 240;
export const DURACOES = [15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240] as const;
/** Plano 23 (RN-410, AG-D9): 60 regras por consultório (cada metade do par de videoconferência conta). */
export const MAX_REGRAS = 60;
/** RN-03: o paciente marca até 60 dias à frente. */
export const JANELA_PACIENTE_DIAS = 60;
/** RN-16: no máximo 3 consultas futuras por e-mail no tenant (página pública e, desde a revisão da T12 do Plano 06, agendamento pelo PWA). */
export const MAX_CONSULTAS_FUTURAS_PUBLICO = 3;
export const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const;
export const ROTULO_MODALIDADE: Record<Modalidade, string> = { presencial: 'Presencial', online: 'Online' };
export const ROTULO_MODALIDADE_REGRA: Record<ModalidadeRegra, string> = { presencial: 'Presencial', online: 'Online', ambas: 'Presencial ou online' };

export const MSG_AGENDA = {
  // US-030 (regras e bloqueios)
  fimAntesDoInicio: 'O fim deve ser depois do início',
  horaInvalida: 'Informe um horário válido (HH:MM)',
  duracao: 'A duração deve ser de 15 a 240 minutos',
  naoCabe: 'O horário precisa caber pelo menos uma consulta',
  sobreposicao: 'Este horário se sobrepõe a outro do mesmo dia.',
  diaSemana: 'Escolha o dia da semana',
  modalidade: 'Escolha a modalidade',
  limiteRegras: 'Você chegou ao limite de 60 horários. Apague um antes de criar outro.',
  /** Plano 23 (RN-407, RN-410, §6.2): regra e consulta sem local ativo do consultório. */
  escolhaOLocal: 'Escolha o local.',
  /** Plano 23 (§6.2, "Horários"). */
  horarioCriado: 'Horário criado.',
  horarioExcluido: 'Horário excluído.',
  dataInvalida: 'Informe uma data válida',
  dataFinalAntes: 'A data final deve ser igual ou posterior à inicial',
  bloqueioLongo: 'O bloqueio pode ter no máximo 366 dias',
  motivoLongo: 'Use no máximo 120 caracteres',
  // US-031 (consulta pela nutricionista)
  pacienteObrigatorio: 'Selecione o paciente',
  pacienteArquivado: 'Paciente arquivado: desarquive para agendar.',
  horaInexistente: 'Este horário não existe neste dia (mudança de horário de verão).',
  linkObrigatorio: 'Informe o link da chamada (https://…)',
  conflito: (nome: string, hora: string) => `Conflito com a consulta de ${nome} às ${hora}`,
  foraDoHorario: 'Fora do seu horário de atendimento',
  dentroDeBloqueio: 'Consulta dentro de um bloqueio',
  naoEncontrada: 'Consulta não encontrada.',
  naoAlteravel: 'Só dá para alterar consulta agendada ou confirmada.',
  marcada: 'Consulta marcada.',
  alterada: 'Consulta alterada.',
  // US-032 / US-033 (paciente)
  ocupado: 'Esse horário acabou de ser ocupado. Escolha outro.',
  indisponivel: 'Esse horário não está mais disponível. Escolha outro.',
  foraDoPrazo: 'Para alterar, fale com sua nutricionista.',
  naoCancelavel: 'Esta consulta não pode mais ser cancelada.',
  cancelada: 'Consulta cancelada.',
  /** R13: motivo do cancelamento (appointments_motivo_tamanho). */
  motivoCancelamentoLongo: 'Use no máximo 300 caracteres',
  limitePublico: 'Você já tem 3 consultas marcadas. Fale com sua nutricionista.',
  semHorarios: 'Nenhum horário livre nos próximos 60 dias. Fale com sua nutricionista.',
  naoAgendavel: 'Não foi possível agendar por aqui. Fale com sua nutricionista.',
  contaIndisponivel: 'Conta temporariamente indisponível',
  // US-033 / US-035 (link da consulta)
  presencaConfirmada: 'Presença confirmada. Até lá!',
  remarcada: (quando: string) => `Consulta remarcada para ${quando}.`,
  linkExpirado: 'Este link expirou.',
  /** Complemento da T7: texto do paciente (o `naoAlteravel` é da equipe). */
  naoConfirmavel: 'Esta consulta não pode mais ser confirmada.',
  linkInvalido: 'Link inválido.',
  consultaJaCancelada: 'Esta consulta foi cancelada.',
  avisoDeRemarcacao: 'Avisamos sua nutricionista. Ela vai entrar em contato.',
  semHorariosNaSemana: 'Nenhum horário livre nesta semana.',
} as const;

/**
 * RN-16 / D12: textos da página pública /n/<slug>. Ficam aqui (e não em agendamento-publico.ts, que fala com o banco)
 * porque o formulário do navegador também os usa.
 */
export const MSG_PUBLICO = {
  indisponivel: 'Agendamento online indisponível. Entre em contato.',
  nome: 'Informe o nome',
  email: 'Informe um e-mail válido',
  telefone: 'Telefone inválido',
  telefoneWhatsapp: 'Informe o telefone para receber lembretes por WhatsApp',
  maioridade: 'Confirme que você tem 18 anos ou mais',
  termo: MSG_TERMO_NAO_ACEITO,
  muitasTentativas: 'Muitas tentativas. Tente novamente mais tarde.',
  aguarde: 'Aguarde 1 minuto para pedir outro código.',
  codigoIncorreto: 'Código incorreto.',
  codigoExpirado: 'Código expirado. Peça um novo código.',
  codigoBloqueado: 'Muitas tentativas com código errado. Peça um novo código.',
  enviado: (email: string) => `Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`,
  agendada: (quando: string) => `Consulta marcada para ${quando}. Enviamos a confirmação para o seu e-mail.`,
  titulo: (nome: string) => `Agendar consulta com ${nome}`,
  /** Plano 23 (§6.2, "Portal e página pública"): a escolha do local (portal, página pública e link). */
  ondeAtender: 'Onde você quer ser atendido?',
  /** Plano 23 (§6.2, US-403): o cabeçalho da página pública — o CRN como gravado; sem CRN, sem a última parte. */
  cabecalho: (nome: string, crn: string | null) => (crn ? `${nome} · Nutricionista · ${crn}` : `${nome} · Nutricionista`),
  /** Plano 23 (§6.2, RN-426): a tela depois do código com a chave dos pedidos ligada — a mesma para paciente e pessoa nova. */
  pedidoEnviado: (nome: string) => `Pedido enviado. ${nome} vai confirmar o horário e você recebe um e-mail.`,
  /** Plano 23 (§6.2, RN-425, RN-426): só depois do código (a dona do e-mail já provou que é ela). */
  pedidoAguardando: 'Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário.',
  /** Plano 23 (§6.2, RN-429, AG-D21): o ponto de coleta, antes de enviar, com a chave ligada (igual ao Termo 1.0). */
  pontoDeColeta:
    'Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados depois de 24 horas, na limpeza diária.',
  /** Plano 23 (§6.2, AG-D42): a página do link de desistência da pessoa nova. */
  pedido: {
    titulo: 'Seu pedido de consulta',
    pergunta: (quando: string) => `Desistir do pedido de ${quando}?`,
    desistir: 'Desistir do pedido',
    cancelado: 'Pedido cancelado.',
    invalido: 'Este link não é válido.',
  },
} as const;

/** Plano 23 (US-400, spec §6.2): rótulos do campo "Tipo" do local. */
export const ROTULO_TIPO_LOCAL: Record<TipoDeLocal, string> = { presencial: 'Presencial', online: 'Videoconferência' };

/** Plano 23 (US-400, spec §6.2): textos dos locais de atendimento. Os sem texto na spec estão marcados (vão à tabela na T12). */
export const MSG_LOCAIS = {
  /**
   * Fora da §6.2 (AG-D82): no "Alterar" da consulta marcada pelo paciente num local online com sala fixa, o "Link da
   * chamada" fica só leitura com este texto — o banco grava a sala do local nesse caso (gatilho `appointments_link_da_sala`
   * e `moverConsulta`).
   */
  salaFixaDoLocal: 'Sala fixa do local',
  salvo: 'Local salvo.',
  arquivado: 'Local arquivado.',
  reativado: 'Local reativado.',
  /** Fora da §6.2 (a spec não tem texto para a exclusão). */
  excluido: 'Local excluído.',
  nomeRepetido: 'Já existe um local com este nome.',
  nomeTamanho: 'O nome tem de 2 a 60 caracteres.',
  emUso: 'Este local tem consultas ou horários. Arquive em vez de excluir.',
  principalNaoArquiva: 'Defina outro local como principal antes de arquivar este.',
  agendamentoSemSala: 'Para aceitar agendamento pelo paciente, informe a sala fixa.',
  link: 'Informe um link que comece com https://.',
  /** Fora da §6.2: limites dos CHECKs de locais_atendimento e do tipo (RN-401). */
  linkLongo: 'Use no máximo 500 caracteres.',
  enderecoLongo: 'Use no máximo 300 caracteres.',
  cidadeLonga: 'Use no máximo 80 caracteres.',
  tipo: 'Escolha o tipo do local.',
  tipoFixo: 'Este local já tem consultas ou horários: o tipo não muda.',
  naoEncontrado: 'Local não encontrado.',
  vazio: 'Cadastre um local de atendimento para marcar consultas e definir horários.',
  linkDivergente: 'O link do Perfil mudou depois da atualização: confira a sala deste local.',
  /** RN-404, sem o número da resolução até o DOU ser conferido (PM-A2, AG-P3). */
  telenutricao: 'Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante. Não grave as consultas.',
  salaDeEspera: 'Use sala de espera ou senha e admita um paciente por vez.',
} as const;

/**
 * Plano 23 (US-404 a US-406, spec §6.2 "Agenda: navegação", "Agenda: filtros", "Agenda: selos e legenda" e "Impressão"):
 * textos das visões, dos filtros, da legenda e da impressão. Os marcados como "fora da §6.2" vão à tabela na T12.
 */
export const MSG_VISOES = {
  visoes: { dia: 'Dia', semana: 'Semana', mes: 'Mês', lista: 'Lista' },
  hoje: 'Hoje',
  anterior: 'Anterior',
  proximo: 'Próximo',
  irParaData: 'Ir para data',
  irParaAData: 'Ir para a data',
  mostrar24Horas: 'Mostrar 24 horas',
  imprimir: 'Imprimir ou salvar em PDF',
  local: 'Local',
  todosOsLocais: 'Todos os locais',
  paciente: 'Paciente',
  todos: 'Todos',
  previsoesDeRetorno: 'Previsões de retorno',
  aniversarios: 'Aniversários',
  filtrar: 'Filtrar',
  limparFiltros: 'Limpar filtros',
  legenda: 'Legenda',
  pedidoAResponder: 'Pedido a responder',
  bloqueio: 'Bloqueio',
  retornoPrevisto: 'Retorno previsto',
  aniversario: 'Aniversário',
  marcadorRetorno: (nome: string) => `Retorno previsto: ${nome}`,
  marcadorAniversario: (nome: string) => `Aniversário: ${nome}`,
  bloqueado: (motivo: string) => (motivo ? `Bloqueado: ${motivo}` : 'Bloqueado'),
  mais: (n: number) => `mais ${n}`,
  /** Fora da §6.2 ("{n} consultas" está no esboço da §7; o singular não). */
  consultas: (n: number) => `${n} ${n === 1 ? 'consulta' : 'consultas'}`,
  /** §7: a consulta que atravessa linhas da grade aparece uma vez, no início, com "até hh:mm". */
  ate: (inicio: string, fim: string) => `${inicio} (até ${fim})`,
  /** Fora da §6.2 (já existia na Lista). */
  semConsultas: 'Nenhuma consulta neste período.',
  /** Fora da §6.2: a lista por dia do celular e a do Mês. */
  semConsultasNoDia: 'Nenhuma consulta.',
  semConsultasNoMes: 'Nenhuma consulta neste mês.',
  /** Fora da §6.2 (já existia no cabeçalho do dia): o dia de hoje em texto, na Semana e no Mês (a cor só reforça). */
  hojeMarca: '(hoje)',
  /** Fora da §6.2: o complemento só para leitor de tela de "Anterior"/"Próximo", com a visão (o texto visível vem antes). */
  vizinhos: {
    dia: { anterior: 'dia anterior', proximo: 'próximo dia' },
    semana: { anterior: 'semana anterior', proximo: 'próxima semana' },
    mes: { anterior: 'mês anterior', proximo: 'próximo mês' },
    lista: { anterior: 'período anterior', proximo: 'próximo período' },
  },
  /** Fora da §6.2: nome acessível dos dois formulários GET da agenda. */
  formularioFiltros: 'Filtros da agenda',
  /** Fora da §6.2: nome do formulário "Ir para data" (diferente do rótulo do campo, para não haver dois elementos com o mesmo nome). */
  formularioData: 'Navegação por data',
  /** Fora da §6.2: cabeçalhos da grade (a coluna das horas e a linha dos marcadores). */
  hora: 'Hora',
  marcadores: 'Marcadores',
  impressao: {
    local: (nome: string) => `Local: ${nome}`,
    voltar: 'Voltar à agenda',
    bloqueado: 'Bloqueado',
    rodape: 'Contém dados pessoais de pacientes. Uso restrito do consultório.',
    /** Fora da §6.2: cabeçalhos da tabela da impressão (os campos da RN-418). */
    colunas: { hora: 'Hora', paciente: 'Paciente', tipoConsulta: 'Tipo', local: 'Local', modalidade: 'Modalidade', situacao: 'Situação' },
  },
} as const;

/**
 * Plano 23 (US-415, US-416, RN-436, RN-437, §6.2): o filtro "Local" fora da agenda — lista de pacientes e Financeiro
 * (Lançamentos, Relatórios e o CSV). "Local" e "Todos os locais" são os da agenda; "Sem local" (lançamento sem consulta
 * ou de consulta antiga) só no Financeiro. O Resumo, o saldo e o fluxo de caixa não se dividem e dizem "Todos os locais".
 */
export const MSG_FILTRO_LOCAL = {
  local: MSG_VISOES.local,
  todosOsLocais: MSG_VISOES.todosOsLocais,
  semLocal: 'Sem local',
  /** Fora da §6.2 (AG-D79): o grupo dos locais arquivados com histórico. */
  arquivados: 'Arquivados',
  /** Fora da §6.2: o seletor do CSV em Relatórios (o filtro da página continua "Local"). */
  localDosLancamentos: 'Local dos lançamentos',
  /** A forma da impressão (§6.2, "Local: {nome ou Todos os locais}"): o recorte dos 12 meses, do fluxo e do Resumo. */
  recorte: MSG_VISOES.impressao.local,
  /** Fora da §6.2: `?local=` que não é uma das opções, num download do CSV. */
  localInvalido: 'Escolha um local da lista.',
} as const;

/**
 * Plano 23 (AG-D41): com a chave dos pedidos ligada, o portal e a página pública só oferecem horários que começam pelo
 * menos `antecedencia_min_h` + 12 h depois de agora — todo pedido dá ao menos 12 h para a resposta. O vencimento continua
 * em `inicio − antecedencia_min_h` (RN-427).
 */
export const JANELA_RESPOSTA_PEDIDO_H = 12;

/**
 * Plano 23 (US-407 a US-409, spec §6.2 "Solicitações", "Agenda: selos e legenda", "Portal e página pública" e
 * "Atendimento"): textos dos pedidos de consulta. Vocabulário (AG-D43): no painel, "Pedido a responder"; no portal,
 * "Aguardando confirmação da nutricionista".
 */
export const MSG_SOLICITACOES = {
  titulo: 'Solicitações',
  novaPessoa: (nome: string) => `Nova pessoa: ${nome}`,
  origem: { app: 'App', pagina: 'Página de agendamento' },
  pedidoEm: (data: string) => `Pedido em ${data}`,
  respondaAte: (data: string, hora: string) => `Responda até ${data} às ${hora}`,
  aceitar: 'Aceitar',
  recusar: 'Recusar',
  confirmarRecusa: (nome: string) => `Recusar o pedido de ${nome}? A pessoa recebe um e-mail avisando.`,
  /** T8: as duas partes de `confirmarRecusa` no diálogo (o título e a descrição; juntas, o texto exato da §6.2). */
  recusaTitulo: (nome: string) => `Recusar o pedido de ${nome}?`,
  recusaAviso: 'A pessoa recebe um e-mail avisando.',
  /** §7: os botões repetidos da fila levam o nome no `aria-label`. */
  aceitarDe: (nome: string) => `Aceitar o pedido de ${nome}`,
  recusarDe: (nome: string) => `Recusar o pedido de ${nome}`,
  /** Abas da agenda e cartão do Início (§6.2 "Abas", US-409 "Início do painel"). */
  aba: (n: number) => `Solicitações (${n})`,
  /** US-407 (§6.2 "Horários"): a chave em Agenda › Horários. */
  chave: {
    titulo: 'Pedidos de consulta',
    rotulo: 'Confirmar os pedidos antes de marcar',
    ajuda: 'Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações.',
    salva: 'Configuração salva.',
    /** Fora da §6.2: o botão do formulário da chave (revisão da T8: diz o que salva). */
    salvar: 'Salvar configuração',
  },
  motivo: 'Motivo (só você vê)',
  confirmarRecusaBotao: 'Confirmar recusa',
  vazio: 'Nenhum pedido aguardando resposta.',
  aceito: 'Pedido aceito. Consulta marcada.',
  recusado: 'Pedido recusado.',
  horarioOcupado: 'Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa.',
  /**
   * /code-review do PR 3 (I-2): o local do pedido da pessoa nova não serve mais (arquivado, de outro tipo ou online sem sala).
   * Fora da §6.2: a frase da §9.1 ("Esse horário não está mais disponível") com a orientação de `horarioOcupado`.
   */
  localIndisponivel: 'Esse horário não está mais disponível. Recuse o pedido ou combine outro horário com a pessoa.',
  emailInativo: 'Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa.',
  mudou: 'Este pedido já foi respondido ou venceu.',
  pedidoAResponder: 'Pedido a responder',
  primeiraOnline: 'Primeira consulta online: confira o TCLE de telenutrição antes de atender.',
  selos: { retirado: 'Pedido retirado pelo paciente', naoAceito: 'Pedido não aceito', vencido: 'Pedido vencido' },
  portal: {
    aguardando: 'Aguardando confirmação da nutricionista',
    naoConfirmado: 'Não confirmado',
    /** AG-D44: a situação do pedido que o próprio paciente retirou (o aviso da tela é "Pedido cancelado."). */
    pedidoCancelado: 'Pedido cancelado',
    pedidoEnviado: 'Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail.',
    desistir: 'Desistir do pedido',
    desistirConfirma: 'Desistir deste pedido?',
    cancelado: 'Pedido cancelado.',
  },
  atendimento: 'Aceite o pedido antes de registrar o atendimento.',
} as const;

/** Plano 23 (RN-431): a situação de um aniversariante na lista (US-412). */
export type SituacaoAniversario = 'pode_receber' | 'sem_autorizacao' | 'menor' | 'ja_enviada' | 'ja_passou' | 'passou_do_horario';

/**
 * Plano 23 (RN-432, RN-434, RN-435): `{nutricionista}` do e-mail, da página de saída e do WhatsApp — o nome profissional
 * (Perfil), ou o de exibição quando ele não estiver preenchido; nunca da tabela `user` (regra 1).
 */
export const nomeDaNutricionista = (t: { nomeExibicao: string; nomeProfissional: string | null }): string => t.nomeProfissional?.trim() || t.nomeExibicao;

const pluralPacientes = (n: number) => (n === 1 ? '1 paciente' : `${n} pacientes`);

/**
 * Plano 23 (US-412 a US-414, spec §6.2 "Aniversariantes", "E-mail de aniversário", "Portal: Perfil" e "Saída do
 * aniversário"): textos do aniversário. Os marcados como "fora da §6.2" vão à tabela na T12. "{n} pacientes" e "{n}
 * marcados" no singular quando n = 1 (variação de número do texto da §6.2).
 */
export const MSG_ANIVERSARIO = {
  titulo: (mes: string) => `Aniversariantes de ${mes}`,
  aba: 'Aniversariantes',
  mesAnterior: 'Mês anterior',
  proximoMes: 'Próximo mês',
  colunas: { paciente: 'Paciente', dia: 'Dia', faz: 'Faz', situacao: 'Situação' },
  situacao: {
    pode_receber: 'Pode receber',
    sem_autorizacao: 'Sem autorização',
    menor: 'Menor de idade',
    ja_enviada: 'Já enviada este ano',
    ja_passou: 'Aniversário já passou',
    passou_do_horario: 'Passou do horário de hoje',
  } satisfies Record<SituacaoAniversario, string>,
  envioAbre: (mes: string) => `O envio abre no dia 1º de ${mes}.`,
  semNascimento: 'Pacientes sem data de nascimento não aparecem nesta lista.',
  selecionarTodos: 'Selecionar todos',
  limparSelecao: 'Limpar seleção',
  marcados: (n: number) => (n === 1 ? '1 marcado' : `${n} marcados`),
  enviar: 'Enviar mensagem',
  abrirWhatsapp: 'Abrir no WhatsApp',
  registrar: 'Registrar autorização',
  retirar: 'Retirar autorização',
  comoAutorizou: 'Como o paciente autorizou?',
  formas: { escrito: 'Por escrito', mensagem: 'Por mensagem', verbal: 'Verbalmente' },
  confirmacao: 'O paciente autorizou receber mensagens de aniversário. Guarde o comprovante.',
  textoPadrao: 'Texto padrão do NutriDebby, enviado em seu nome',
  vaiPara: (n: number) => `Vai para ${pluralPacientes(n)} por e-mail, às 9h do dia do aniversário.`,
  saemAgora: (n: number) => `${n} de hoje saem agora.`,
  agendadas: (n: number) => `Mensagens agendadas: ${n}.`,
  vazio: 'Nenhum aniversariante neste mês.',
  menor: 'Menor de idade',
  /** Início do painel (US-412). */
  inicio: (n: number) => `Aniversariantes de hoje (${n})`,
  /** Fora da §6.2: o link do cartão do Início (como "Abrir Diários"). */
  abrir: 'Abrir Aniversariantes',
  /** E-mail (RN-432): o nome do paciente só no corpo. */
  assunto: 'Uma mensagem da sua nutricionista',
  /** O texto fixo do e-mail e do WhatsApp (RN-432, RN-435). */
  mensagem: (primeiroNome: string, nutri: string) => `Feliz aniversário, ${primeiroNome}! ${nutri} deseja a você um novo ano com muita saúde.`,
  rodape: (nutri: string) => `Mensagem enviada pelo NutriDebby a pedido de ${nutri}.`,
  naoQueroMais: 'Não quero mais receber mensagens de aniversário',
  portal: {
    titulo: 'Receber mensagem de aniversário da sua nutricionista',
    // texto provisório (AG-D78): a Debby revisa
    ajuda: 'Uma mensagem por ano, por e-mail (e, se a sua nutricionista quiser, pelo WhatsApp dela), no dia do seu aniversário. Usamos seu nome, sua data de nascimento, seu e-mail e seu telefone. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail.',
    autorizar: 'Autorizar',
    retirar: 'Retirar autorização',
    autorizadoEm: (data: string) => `Autorizado em ${data}`,
    naoAutorizado: 'Não autorizado',
    menor: 'Menor de idade',
    erro: 'Não foi possível salvar. Tente de novo.',
  },
  saida: {
    titulo: 'Mensagens de aniversário',
    pergunta: (nutri: string) => `Você não quer mais receber mensagens de aniversário de ${nutri}?`,
    confirmar: 'Confirmar',
    pronto: 'Pronto. Você não vai mais receber mensagens de aniversário.',
    invalido: 'Este link não é válido.',
  },
  /** Fora da §6.2: erros do registro da autorização (o diálogo mostra junto dos campos). */
  formaObrigatoria: 'Escolha como o paciente autorizou.',
  confirmeAutorizacao: 'Confirme que o paciente autorizou.',
  naoPodeAutorizar: 'Só paciente ativo pode autorizar mensagens de aniversário.',
  /** Fora da §6.2: a volta das ações da linha (região de status da tela). */
  autorizacaoRegistrada: 'Autorização registrada.',
  autorizacaoRetirada: 'Autorização retirada.',
  /** Fora da §6.2: nomes acessíveis (botões repetidos com o nome; colunas sem título visível; navegação e prévia). */
  selecionar: (nome: string) => `Selecionar ${nome}`,
  registrarDe: (nome: string) => `Registrar autorização de ${nome}`,
  retirarDe: (nome: string) => `Retirar autorização de ${nome}`,
  whatsappDe: (nome: string) => `Abrir no WhatsApp: ${nome}`,
  colunaSelecao: 'Selecionar',
  colunaAcoes: 'Ações',
  navegacaoDoMes: 'Meses',
  previa: 'Prévia da mensagem',
  /** Fora da §6.2: na prévia, o lugar do primeiro nome de cada paciente. */
  primeiroNomeNaPrevia: '{primeiro nome}',
} as const;
