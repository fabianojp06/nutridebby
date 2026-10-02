import type { Modalidade, ModalidadeRegra } from './horarios';

export const DURACAO_MIN = 15;
export const DURACAO_MAX = 240;
export const DURACOES = [15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240] as const;
export const MAX_REGRAS = 30;
/** RN-03: o paciente marca até 60 dias à frente. */
export const JANELA_PACIENTE_DIAS = 60;
/** RN-16: no máximo 3 consultas futuras por e-mail no tenant (página pública). */
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
  limiteRegras: 'Limite de 30 horários de atendimento.',
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
