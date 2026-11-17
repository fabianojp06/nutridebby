/**
 * Spec §7 (Mensagens e foco): o h1 de cada tela do Financeiro tem este id e `tabIndex={-1}`, e recebe o foco quando a URL
 * chega com `ok=` ou depois de uma ação que tira a linha da lista. Módulo puro: o servidor usa o id, o cliente o foco.
 */
export const ID_TITULO = 'titulo-financeiro';

export function focarTitulo(): void {
  document.getElementById(ID_TITULO)?.focus();
}
