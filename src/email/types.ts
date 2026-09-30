/** Toda mensagem que o sistema envia. `link` pode conter token: por isso o job inteiro vai cifrado. */
export type EmailMessage =
  | { tipo: 'convite_nutri'; para: string; nome: string; link: string }
  | { tipo: 'redefinir_senha'; para: string; link: string }
  | { tipo: 'alerta_disco'; para: string; percentual: number; painelUrl: string }
  | { tipo: 'alerta_backup'; para: string; detalhe: string; painelUrl: string }
  | { tipo: 'convite_paciente'; para: string; nome: string; nutri: string; link: string; contaExistente: boolean }
  | { tipo: 'exclusao_atendida'; para: string; nome: string; nutri: string; anonimizarApos: string };

/** Payload do job `email` no pg-boss: nada legível além do tenant (RN-15). */
export type EmailJobData = { tenantId: string | null; selado: string };

export type RenderedEmail = { subject: string; html: string; text: string };
