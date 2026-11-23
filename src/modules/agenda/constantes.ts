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
} as const;

/** Plano 23 (US-400, spec §6.2): rótulos do campo "Tipo" do local. */
export const ROTULO_TIPO_LOCAL: Record<TipoDeLocal, string> = { presencial: 'Presencial', online: 'Videoconferência' };

/** Plano 23 (US-400, spec §6.2): textos dos locais de atendimento. Os sem texto na spec estão marcados (vão à tabela na T12). */
export const MSG_LOCAIS = {
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
