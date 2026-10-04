import { MSG_CONTEUDO } from './constantes';

/** Erros por campo (`titulo`, `resumo`, `etiquetas`, `visibilidade`, `link`, `corpo`, `geral`). */
export class ConteudoError extends Error {
  override name = 'ConteudoError';
  constructor(readonly erros: Record<string, string>) {
    super('Conteúdo inválido');
  }
}

export class ConteudoNaoEncontradoError extends Error {
  override name = 'ConteudoNaoEncontradoError';
  constructor() {
    super(MSG_CONTEUDO.naoEncontrado);
  }
}

/** D9: a capa do oEmbed chegou depois de outro salvamento trocar o link — a capa é do salvamento mais novo. */
export class VideoTrocadoError extends Error {
  override name = 'VideoTrocadoError';
}
