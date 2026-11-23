import type { NotificationRow } from '@/db/schema';
import { formatarQuando } from '@/modules/agenda/fuso';

export const CANAIS = ['email', 'whatsapp', 'push'] as const;
export type Canal = (typeof CANAIS)[number];
export type TipoLembrete = 'lembrete_24h' | 'lembrete_2h';
export type TipoNotificacao =
  | TipoLembrete | 'consulta_marcada' | 'consulta_cancelada' | 'convite_paciente' | 'resposta_confirmacao' | 'resposta_remarcar'
  | 'push_teste' | 'comentario_diario' | 'plano_novo' | 'conteudo_novo' | 'documento_novo' | 'documento_atualizado' | 'exame_revisado' | 'exame_expirado'
  | 'duvida_vista';
export type StatusNotificacao = 'pendente' | 'enviando' | 'enviada' | 'entregue' | 'lida' | 'falhou' | 'ignorada';
export type MotivoIgnorada =
  | 'prazo_passado' | 'horario_silencioso' | 'consulta_cancelada' | 'consulta_remarcada' | 'consulta_encerrada' | 'paciente_inativo' | 'tenant_suspenso'
  | 'sem_optin' | 'sem_telefone' | 'whatsapp_desligado' | 'whatsapp_desconectado' | 'cota_esgotada' | 'sem_inscricao' | 'push_desligado'
  | 'convite_aceito';

export const ehLembrete = (t: string): t is TipoLembrete => t === 'lembrete_24h' || t === 'lembrete_2h';

export const ROTULO_TIPO: Record<TipoNotificacao, string> = {
  lembrete_24h: 'Lembrete de 24 h',
  lembrete_2h: 'Lembrete de 2 h',
  consulta_marcada: 'Confirmação da marcação',
  consulta_cancelada: 'Aviso de cancelamento',
  convite_paciente: 'Convite',
  resposta_confirmacao: 'Resposta ao paciente',
  resposta_remarcar: 'Resposta ao paciente',
  push_teste: 'Notificação de teste',
  comentario_diario: 'Comentário no diário',
  plano_novo: 'Plano novo',
  conteudo_novo: 'Conteúdo novo',
  documento_novo: 'Documento novo',
  documento_atualizado: 'Documento atualizado',
  exame_revisado: 'Exame revisado',
  exame_expirado: 'Exame expirado',
  duvida_vista: 'Atualização no app',
};
export const ROTULO_CANAL: Record<Canal, string> = { email: 'E-mail', whatsapp: 'WhatsApp', push: 'Notificação no app' };
export const ROTULO_MOTIVO: Record<MotivoIgnorada, string> = {
  prazo_passado: 'já tinha passado do horário',
  horario_silencioso: 'horário silencioso (21h–8h)',
  consulta_cancelada: 'consulta cancelada',
  consulta_remarcada: 'consulta remarcada',
  consulta_encerrada: 'consulta encerrada',
  paciente_inativo: 'paciente arquivado ou bloqueado',
  tenant_suspenso: 'conta suspensa',
  sem_optin: 'sem autorização de WhatsApp',
  sem_telefone: 'sem telefone',
  whatsapp_desligado: 'WhatsApp não configurado na plataforma',
  whatsapp_desconectado: 'WhatsApp desconectado',
  cota_esgotada: 'cota de WhatsApp do mês esgotada',
  sem_inscricao: 'paciente sem notificações no app',
  push_desligado: 'notificações no app não configuradas',
  convite_aceito: 'convite já aceito',
};

/** O motivo de não envio em texto ("consulta cancelada"…); motivo que o código não conhece não quebra a tela. */
export const rotuloDoMotivo = (motivo: string | null): string => ROTULO_MOTIVO[motivo as MotivoIgnorada] ?? 'motivo desconhecido';

/** Situação em texto (US-034; acessibilidade: nunca só cor). */
export function situacaoDaNotificacao(n: Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'>, fuso: string): string {
  switch (n.status as StatusNotificacao) {
    case 'pendente':
      return `Agendado para ${formatarQuando(n.agendadaPara, fuso)}`;
    case 'enviando':
      return 'Enviando…';
    case 'enviada':
      return `Enviado em ${formatarQuando(n.enviadaEm ?? n.agendadaPara, fuso)}`;
    case 'entregue':
      return 'Entregue';
    case 'lida':
      return 'Lido';
    case 'falhou':
      return 'Falhou';
    case 'ignorada':
      return `Não enviado: ${rotuloDoMotivo(n.motivoIgnorada)}`;
    default:
      return n.status;
  }
}

/**
 * Plano 26 (RN-507, RE-D57): os tipos que a sessão `recepcao` lê e grava — os da agenda —, iguais à lista da condição
 * `recepcao_cond_notificacoes_da_agenda` (custom rls_recepcao). Sem `convite_paciente`: a recepção não envia o convite do app
 * (RE-D37). Todo tipo do CHECK `notifications_tipo_valido` está aqui ou em TIPOS_FORA_DA_RECEPCAO (tipos.test.ts): tipo novo
 * de outro plano entra com a decisão; o que entra aqui entra também na política (CREATE OR REPLACE da condição).
 */
export const TIPOS_DA_AGENDA = [
  'lembrete_24h',
  'lembrete_2h',
  'consulta_marcada',
  'consulta_cancelada',
  'resposta_confirmacao',
  'resposta_remarcar',
] as const satisfies readonly TipoNotificacao[];

/** Plano 26 (RN-507): os tipos que a recepção não lê nem grava — convite do app (RE-D37), avisos clínicos e do portal. */
export const TIPOS_FORA_DA_RECEPCAO = [
  'convite_paciente',
  'push_teste',
  'comentario_diario',
  'plano_novo',
  'conteudo_novo',
  'documento_novo',
  'documento_atualizado',
  'exame_revisado',
  'exame_expirado',
  'duvida_vista',
] as const satisfies readonly TipoNotificacao[];
