import type { PatientRow } from '@/db/schema';
import { rotuloDoMotivo, situacaoDaNotificacao } from '@/modules/notificacoes/tipos';
import type { SituacaoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { CAMPOS_DO_CADASTRO, type CadastroComplementar, type CampoDoCadastro } from '@/modules/pacientes/cadastro';
import type { SituacaoAcesso, SituacaoConviteWhatsapp } from '@/modules/pacientes/convite-paciente';
import { formatarCpf } from '@/modules/pacientes/cpf';
import type { FiltroDaLista, PacienteNaLista } from '@/modules/pacientes/pacientes';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';

/**
 * O que o formulário de cadastro manda e recebe de volta num erro (PF-N9: nada do que foi digitado se perde). Plano 18
 * (US-260): com os campos do cadastro complementar, como texto ('' quando vazio).
 */
export type ValoresPaciente = {
  nome: string;
  dataNascimento: string;
  sexo: string;
  email: string;
  telefone: string;
  whatsappAutorizado: boolean;
  /** US-010: só no cadastro. */
  enviarConviteWhatsapp: boolean;
} & Record<CampoDoCadastro, string>;

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
    ...(Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, campo(f, c)])) as Record<CampoDoCadastro, string>),
  };
}

/**
 * O que as ações mandam a `criarPaciente`/`atualizarPaciente`: os valores do formulário, mas só com os campos do
 * cadastro complementar que o FormData trouxe. O formulário manda todos ('' quando vazio = esvaziar); um campo que não
 * veio (um select desabilitado não entra no FormData) fica de fora e mantém o que está gravado (`gravarCadastro`).
 */
export function entradaDoFormulario(f: FormData): Record<string, unknown> {
  const v: Record<string, unknown> = { ...valoresDoFormulario(f) };
  for (const c of CAMPOS_DO_CADASTRO) if (!f.has(c)) delete v[c];
  return v;
}

const CEP = /^(\d{5})(\d{3})$/;
/** O cadastro complementar como o formulário mostra: CPF, CEP e telefone fixo formatados; sem linha, tudo ''. */
function valoresDoCadastro(c: CadastroComplementar | null): Record<CampoDoCadastro, string> {
  const v = Object.fromEntries(CAMPOS_DO_CADASTRO.map((k) => [k, c?.[k] ?? ''])) as Record<CampoDoCadastro, string>;
  if (v.cpf) v.cpf = formatarCpf(v.cpf);
  if (v.cep) v.cep = v.cep.replace(CEP, '$1-$2');
  if (v.telefoneFixo) v.telefoneFixo = formatarTelefone(v.telefoneFixo);
  return v;
}

export function valoresDoPaciente(p: PatientRow, cadastro: CadastroComplementar | null = null): ValoresPaciente {
  return {
    nome: p.nome,
    dataNascimento: p.dataNascimento ?? '',
    sexo: p.sexo ?? '',
    email: p.email,
    telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : '',
    whatsappAutorizado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
    enviarConviteWhatsapp: false,
    ...valoresDoCadastro(cadastro),
  };
}

/** "Novo paciente": tudo vazio. */
export const VALORES_VAZIOS: ValoresPaciente = Object.freeze({
  nome: '',
  dataNascimento: '',
  sexo: '',
  email: '',
  telefone: '',
  whatsappAutorizado: false,
  enviarConviteWhatsapp: false,
  ...valoresDoCadastro(null),
});

/** Selo do cabeçalho do prontuário (US-018 "Arquivado"). */
export function seloDoPaciente(p: Pick<PatientRow, 'status' | 'origem' | 'dataNascimento' | 'sexo'>): string | null {
  if (p.status === 'arquivado') return 'Arquivado';
  if (p.status === 'bloqueado') return 'Bloqueado (pedido de exclusão)';
  if (p.origem === 'agendamento_publico' && (!p.dataNascimento || !p.sexo)) return 'Completar cadastro';
  return null;
}

/**
 * A frase longa do acesso ao app (Perfil e cartão "No app"). Plano 18 (§8.1): a situação do paciente vence o `user_id` —
 * o `estado: 'ativo'` de `situacaoDoAcesso` só olha o `user_id`, mas arquivado e bloqueado não entram no app.
 */
export function textoDoAcesso(s: SituacaoAcesso, fuso: string, status: PatientRow['status']): string {
  if (status === 'arquivado') return 'Sem acesso (arquivado)';
  if (status === 'bloqueado') return 'Sem acesso (bloqueado)';
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
 * Plano 18 (§8.1): o rótulo curto da coluna "Acesso ao app" da lista. A situação do paciente vence o `user_id` (arquivado e
 * bloqueado não entram no app); a frase longa (`textoDoAcesso`) fica no Perfil e no "No app".
 */
export function rotuloDoAcessoNaLista(p: Pick<PacienteNaLista, 'status' | 'userId'> & { convite: SituacaoAcesso }): string {
  if (p.status === 'arquivado') return 'Sem acesso (arquivado)';
  if (p.status === 'bloqueado') return 'Sem acesso (bloqueado)';
  if (p.userId) return 'Ativo';
  switch (p.convite.estado) {
    case 'ativo':
      return 'Ativo';
    case 'pendente':
      return 'Pendente';
    case 'expirado':
      return 'Expirado';
    case 'sem_convite':
      return 'Sem convite';
  }
}

/**
 * Plano 18 (RN-270, D26): a URL da lista para um filtro — os links das abas e o "Ver bloqueados" (a busca, a etiqueta e a
 * ordem continuam) e a volta das ações da lista (com `ok`). Sempre `/painel/pacientes`, montada aqui: nada vem pronto de
 * um campo do formulário (sem redirect aberto). A ordem padrão (`nome`) e a `registro` (só da agenda) ficam de fora.
 */
export function urlDaLista(filtro: FiltroDaLista, extra: { ok?: 'arquivado' | 'reativado' } = {}): string {
  const q = new URLSearchParams();
  const aba = filtro.aba ?? 'ativos';
  if (aba === 'bloqueados') q.set('situacao', 'bloqueados');
  else q.set('aba', aba);
  const busca = filtro.busca?.trim();
  if (busca) q.set('busca', busca);
  if (filtro.etiquetaId) q.set('etiqueta', filtro.etiquetaId);
  if (filtro.ordem && filtro.ordem !== 'nome' && filtro.ordem !== 'registro') q.set('ordem', filtro.ordem);
  if (extra.ok) q.set('ok', extra.ok);
  return `/painel/pacientes?${q.toString()}`;
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
