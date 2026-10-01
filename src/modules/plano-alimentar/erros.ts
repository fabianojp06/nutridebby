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
export class PlanoError extends Error {
  override name = 'PlanoError';
  constructor(readonly erros: Record<string, string>) {
    super('Plano inválido');
  }
}
