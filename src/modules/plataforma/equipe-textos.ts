import type { MotivoSemPermissao } from '@/lib/session-rules';

/**
 * Plano 26 (spec §6.2): textos da recepção, exatos da spec e neutros em gênero para a pessoa da recepção. A T7 acrescenta
 * `MSG_EQUIPE` e `EQUIPE_LIGADA` (RE-D52) neste arquivo.
 */
export const MSG_RECEPCAO = {
  /** RE-D47 (US-490): "Sem permissão", com um texto por motivo. */
  semPermissao: {
    titulo: 'Sem permissão',
    motivo: {
      nutri: 'Esta página é só da nutricionista.',
      financeiro: 'Você não tem permissão para o Financeiro. Peça à nutricionista.',
    } satisfies Record<MotivoSemPermissao, string>,
    voltar: 'Voltar ao início',
  },
  /** RN-503 (RE-D45): a conta desativada. */
  acessoDesativado: {
    titulo: 'Acesso desativado',
    texto: 'Seu acesso a este consultório foi desativado. Fale com a nutricionista.',
  },
  /** RN-501 (RE-D29): o DPA do consultório pendente. */
  contratoPendente: {
    titulo: 'Contrato do consultório pendente',
    texto: 'O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby.',
  },
  /** RN-500 (RE-D20): o 2FA obrigatório, na Segurança da conta. */
  doisFatoresObrigatorio: 'A recepção precisa da verificação em duas etapas. Configure agora para continuar.',
} as const;
