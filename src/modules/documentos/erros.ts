/** Erros do módulo de documentos. As mensagens são as da spec v0.3 (US-142 a US-144): nunca levam CN, CPF ou conteúdo. */
export class DocumentoNaoEncontradoError extends Error {
  override name = 'DocumentoNaoEncontradoError';
  constructor() {
    super('Documento não encontrado.');
  }
}
export class DocumentoError extends Error {
  override name = 'DocumentoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'Documento inválido.');
  }
}
/** RN-141: a ação não vale no estado atual (outra aba já preparou, assinou, voltou a editar…). */
export class TransicaoInvalidaError extends Error {
  override name = 'TransicaoInvalidaError';
  constructor() {
    super('Este documento mudou de situação. Recarregue a página.');
  }
}

/** Plano 10A: as recusas do envio digitalizado. O Plano 10B acrescenta as da conferência do PDF assinado (US-144). */
export type CodigoRecusa = 'sem_2fa' | 'codigo_2fa' | 'tentativas_2fa' | 'imagens' | 'sem_habilitacao';

/** US-144 (texto exato da spec v0.3); `sem_habilitacao` é texto novo deste plano (Minor 9 da revisão de segurança, tabela de desvios). */
export const MSG_RECUSA: Record<CodigoRecusa, string> = {
  sem_2fa: 'Ative a verificação em duas etapas em Segurança para assinar documentos.',
  codigo_2fa: 'Código inválido. Confira o horário do celular e tente de novo.',
  tentativas_2fa: 'Muitas tentativas. Tente de novo em 15 minutos.',
  imagens: 'Envie fotos das páginas (JPEG ou PNG).',
  sem_habilitacao: 'A receita tem fitoterápico formulado e a habilitação em Fitoterapia não está mais no seu perfil. Registre a habilitação de novo ou volte a editar a receita.',
};

export class RecusaAssinaturaError extends Error {
  override name = 'RecusaAssinaturaError';
  /** `motivoTecnico`: só para o log (fixo, sem dado pessoal), ex.: "pixels". O Plano 10B acrescenta o nome do certificado. */
  constructor(readonly codigo: CodigoRecusa, readonly motivoTecnico: string = codigo) {
    super(MSG_RECUSA[codigo]);
  }
  /** A mensagem da tela (as rotas usam sempre esta; o 10B a estende com o nome do certificado). */
  mensagem(): string {
    return MSG_RECUSA[this.codigo];
  }
}
