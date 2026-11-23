import { MSG_LOCAIS } from '@/modules/agenda/constantes';

/**
 * Volta das ações da tela de Locais pela URL (`?ok=` e `?erro=`): lista fechada de chaves, para a página nunca mostrar texto
 * vindo da URL (outro valor, inclusive `constructor` e `toString`, não mostra nada).
 */
export const OK_LOCAIS = { salvo: MSG_LOCAIS.salvo, arquivado: MSG_LOCAIS.arquivado, reativado: MSG_LOCAIS.reativado, excluido: MSG_LOCAIS.excluido } as const;
export const ERRO_LOCAIS = {
  naoEncontrado: MSG_LOCAIS.naoEncontrado,
  principalNaoArquiva: MSG_LOCAIS.principalNaoArquiva,
  emUso: MSG_LOCAIS.emUso,
  nomeRepetido: MSG_LOCAIS.nomeRepetido,
} as const;

export function lerRetorno<T extends Record<string, string>>(mapa: T, valor: unknown): keyof T | null {
  return typeof valor === 'string' && Object.hasOwn(mapa, valor) ? valor : null;
}

/** A chave do erro de uma ação de botão (a mensagem fixa de `LocalError.erros.geral`). */
export function chaveDoErro(mensagem: string | undefined): keyof typeof ERRO_LOCAIS {
  return (Object.keys(ERRO_LOCAIS) as (keyof typeof ERRO_LOCAIS)[]).find((k) => ERRO_LOCAIS[k] === mensagem) ?? 'naoEncontrado';
}
