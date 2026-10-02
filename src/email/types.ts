/** Toda mensagem que o sistema envia. `link` pode conter token: por isso o job inteiro vai cifrado. */
export type EmailMessage =
  | { tipo: 'convite_nutri'; para: string; nome: string; link: string }
  | { tipo: 'redefinir_senha'; para: string; link: string }
  | { tipo: 'alerta_disco'; para: string; percentual: number; painelUrl: string }
  | { tipo: 'alerta_backup'; para: string; detalhe: string; painelUrl: string }
  | { tipo: 'convite_paciente'; para: string; nome: string; nutri: string; link: string; contaExistente: boolean }
  | { tipo: 'exclusao_atendida'; para: string; nome: string; nutri: string; anonimizarApos: string }
  | { tipo: 'exportacao_pronta'; para: string; link: string }
  /** RN-16: código de 6 dígitos da página pública (o job da fila `email` vai cifrado, como todos). */
  | { tipo: 'codigo_agendamento'; para: string; nutri: string; codigo: string }
  | {
      tipo: 'consulta';
      evento: 'lembrete_24h' | 'lembrete_2h' | 'consulta_marcada' | 'consulta_cancelada';
      para: string;
      nome: string;
      nutri: string;
      /** "sex., 16/10/2026 às 14:00 (horário de Brasília)" */
      quando: string;
      hora: string;
      modalidade: 'presencial' | 'online';
      /** Endereço (presencial) ou link da chamada (online). */
      local: string | null;
      /** Link assinado da consulta (D20); nulo no cancelamento. Não passa pela fila: é renderizado no envio. */
      link: string | null;
    }
  | {
      tipo: 'aviso_agenda';
      para: string;
      evento: 'marcada' | 'remarcada' | 'cancelada' | 'pedido_remarcacao' | 'novo_paciente_publico';
      paciente: string;
      /** "sex., 16/10/2026 às 09:00 (horário de Brasília)" */
      quando: string;
      link: string;
    };

/** Payload do job `email` no pg-boss: nada legível além do tenant (RN-15). */
export type EmailJobData = { tenantId: string | null; selado: string };

export type RenderedEmail = { subject: string; html: string; text: string };
