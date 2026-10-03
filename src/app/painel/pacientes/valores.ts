import type { PatientRow } from '@/db/schema';
import { rotuloDoMotivo, situacaoDaNotificacao } from '@/modules/notificacoes/tipos';
import type { SituacaoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import type { SituacaoAcesso, SituacaoConviteWhatsapp } from '@/modules/pacientes/convite-paciente';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';

/** O que o formulário de cadastro manda e recebe de volta num erro (PF-N9: nada do que foi digitado se perde). */
export type ValoresPaciente = {
  nome: string;
  dataNascimento: string;
  sexo: string;
  email: string;
  telefone: string;
  whatsappAutorizado: boolean;
  /** US-010: só no cadastro. */
  enviarConviteWhatsapp: boolean;
};

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');

export function valoresDoFormulario(f: FormData): ValoresPaciente {
  return {
    nome: campo(f, 'nome'),
    dataNascimento: campo(f, 'dataNascimento'),
    sexo: campo(f, 'sexo'),
    email: campo(f, 'email'),
    telefone: campo(f, 'telefone'),
    whatsappAutorizado: f.get('whatsappAutorizado') === 'on',
    enviarConviteWhatsapp: f.get('enviarConviteWhatsapp') === 'on',
  };
}

export function valoresDoPaciente(p: PatientRow): ValoresPaciente {
  return {
    nome: p.nome,
    dataNascimento: p.dataNascimento ?? '',
    sexo: p.sexo ?? '',
    email: p.email,
    telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : '',
    whatsappAutorizado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
    enviarConviteWhatsapp: false,
  };
}

/** Selo do cabeçalho do prontuário (US-018 "Arquivado"). */
export function seloDoPaciente(p: Pick<PatientRow, 'status' | 'origem' | 'dataNascimento' | 'sexo'>): string | null {
  if (p.status === 'arquivado') return 'Arquivado';
  if (p.status === 'bloqueado') return 'Bloqueado (pedido de exclusão)';
  if (p.origem === 'agendamento_publico' && (!p.dataNascimento || !p.sexo)) return 'Completar cadastro';
  return null;
}

export function textoDoAcesso(s: SituacaoAcesso, fuso: string): string {
  switch (s.estado) {
    case 'ativo':
      return 'Ativo: o paciente já criou a senha.';
    case 'pendente':
      return `Convite enviado por e-mail. Vale até ${formatarDataHora(s.expiraEm, fuso)}.`;
    case 'expirado':
      return 'Convite expirado. Reenvie para o paciente conseguir entrar.';
    case 'sem_convite':
      return 'Nenhum convite pendente.';
  }
}

/**
 * US-010: situação do convite por WhatsApp na tela do paciente — "Convite por WhatsApp: {situação}"; quando não saiu,
 * "Convite por WhatsApp não enviado: {motivo}" (sem "::"). Sem convite por WhatsApp, nada.
 */
export function textoDoConviteWhatsapp(n: SituacaoConviteWhatsapp | null, fuso: string): string | null {
  if (!n) return null;
  if (n.status === 'ignorada') return `Convite por WhatsApp não enviado: ${rotuloDoMotivo(n.motivoIgnorada)}`;
  return `Convite por WhatsApp: ${situacaoDaNotificacao(n, fuso).replace(/^./, (c) => c.toLowerCase())}`;
}

/** US-010 (rodada 1): ao lado de "Enviar convite por WhatsApp", quando a mensagem não teria como sair agora. */
export function avisoDoConviteWhatsapp(s: Pick<SituacaoWhatsapp, 'ligado' | 'estado'>): string | null {
  if (!s.ligado) return 'O WhatsApp ainda não está disponível na plataforma; o convite vai só por e-mail.';
  return s.estado === 'conectada' ? null : 'O WhatsApp do consultório não está conectado; o convite vai só por e-mail.';
}
