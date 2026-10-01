import { MSG_PLANO } from './constantes';

export class PlanoNaoEncontradoError extends Error {
  override name = 'PlanoNaoEncontradoError';
  constructor() {
    super(MSG_PLANO.naoEncontrado);
  }
}
export class PlanoNaoEditavelError extends Error {
  override name = 'PlanoNaoEditavelError';
  constructor() {
    super(MSG_PLANO.naoEditavel);
  }
}
export class ConflitoRevisaoError extends Error {
  override name = 'ConflitoRevisaoError';
  constructor() {
    super(MSG_PLANO.conflito);
  }
}
/** "Gerar o PDF de novo" com o PDF já em preparo (outra aba pediu, ou a tela é de antes do pedido). */
export class PdfEmPreparoError extends Error {
  override name = 'PdfEmPreparoError';
  constructor() {
    super(MSG_PLANO.pdfPreparando);
  }
}
export class PlanoError extends Error {
  override name = 'PlanoError';
  constructor(readonly erros: Record<string, string>) {
    super('Plano inválido');
  }
}
