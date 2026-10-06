/** Toda mensagem que o sistema envia. `link` pode conter token: por isso o job inteiro vai cifrado. */
export type EmailMessage =
  | { tipo: 'convite_nutri'; para: string; nome: string; link: string }
  | { tipo: 'redefinir_senha'; para: string; link: string }
  | { tipo: 'alerta_disco'; para: string; percentual: number; painelUrl: string }
  | { tipo: 'alerta_backup'; para: string; detalhe: string; painelUrl: string }
  | { tipo: 'convite_paciente'; para: string; nome: string; nutri: string; link: string; contaExistente: boolean }
  | { tipo: 'exclusao_atendida'; para: string; nome: string; nutri: string; anonimizarApos: string }
  /** `titular`: pedida pelo paciente no portal (US-046) — o link abre o portal, não o painel. */
  | { tipo: 'exportacao_pronta'; para: string; link: string; titular?: boolean }
  /** US-046 / D17: o titular pediu a exclusão pelo portal; `prazo` = dd/mm/aaaa (15 dias no fuso do tenant). */
  | { tipo: 'pedido_exclusao_registrado'; para: string; nutri: string; prazo: string }
  /** US-025: a nutricionista publicou um plano novo; `link` = /p/plano. Sem dado de saúde. */
  | { tipo: 'plano_novo'; para: string; link: string }
  /** US-145 / RN-152: documento novo no portal; sem tipo de documento, item ou produto. `nome` = primeiro nome. */
  | { tipo: 'documento_novo'; para: string; nome: string; consultorio: string; link: string }
  /** RN-158 / D3 b: paciente sem conta — o link de uso único (pede um código no e-mail para abrir). */
  | { tipo: 'documento_link'; para: string; nome: string; consultorio: string; link: string }
  /** US-149 / D11: documento cancelado — e-mail neutro (nem o tipo do documento, nem o motivo); link do portal ou de uso único. */
  | { tipo: 'documento_atualizado'; para: string; nome: string; consultorio: string; link: string }
  /** RN-158 / D3 b: código de 6 dígitos para abrir o documento pelo link (neutro: sem tipo nem conteúdo do documento). */
  | { tipo: 'codigo_documento'; para: string; codigo: string; consultorio: string }
  /** RN-16: código de 6 dígitos da página pública (o job da fila `email` vai cifrado, como todos). */
  | { tipo: 'codigo_agendamento'; para: string; nutri: string; codigo: string }
  | {
      tipo: 'consulta';
      /** `resposta_remarcar`: o paciente respondeu "2" no WhatsApp (US-035) — e-mail novo com o link para remarcar. */
      evento: 'lembrete_24h' | 'lembrete_2h' | 'consulta_marcada' | 'consulta_cancelada' | 'resposta_remarcar';
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
      /** Só em `resposta_remarcar`: antecedência mínima do consultório para cancelar/remarcar pelo link (RN-04). */
      prazoH?: number;
    }
  | {
      tipo: 'aviso_agenda';
      para: string;
      evento: 'marcada' | 'remarcada' | 'cancelada' | 'pedido_remarcacao' | 'novo_paciente_publico';
      paciente: string;
      /** "sex., 16/10/2026 às 09:00 (horário de Brasília)" */
      quando: string;
      link: string;
    }
  /**
   * Fechamento do Plano 05 (US-018): o pedido de exclusão atendido cancelou as consultas futuras do paciente (sem aviso a
   * ele). `paciente` = primeiro nome; sem dado de saúde.
   */
  | { tipo: 'exclusao_consultas_canceladas'; para: string; paciente: string; quantidade: number }
  /** D18: o celular saiu de "Aparelhos conectados" (não foi pelo painel); `link` = /painel/whatsapp. */
  | { tipo: 'whatsapp_desconectado'; para: string; link: string }
  /** US-036: 80% (ou mais) da cota de WhatsApp do mês, uma vez por mês; `link` = /painel/whatsapp. */
  | { tipo: 'cota_whatsapp'; para: string; usadas: number; cota: number; link: string }
  /** P09-02 (b): o admin (ou o comando no servidor) reiniciou o 2FA da conta; sem link (aviso de segurança). */
  | { tipo: 'aviso_2fa_reiniciado'; para: string }
  /** Plano 11 (US-102): 80% da cota de IA do mês, uma vez por mês; `link` = /painel/configuracoes. Sem valores em US$. */
  | { tipo: 'cota_ia'; para: string; link: string }
  /** Plano 11 (RN-105): aos admins — credencial do provedor inválida (1 por hora) ou teto/limite de gasto atingido (1 por mês). */
  | { tipo: 'alerta_ia'; para: string; motivo: 'credencial' | 'teto'; painelUrl: string };

/** Payload do job `email` no pg-boss: nada legível além do tenant (RN-15). */
export type EmailJobData = { tenantId: string | null; selado: string };

export type RenderedEmail = { subject: string; html: string; text: string };
