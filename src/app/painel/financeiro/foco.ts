/**
 * Spec §7 (Mensagens e foco): o h1 de cada tela do Financeiro tem este id e `tabIndex={-1}`, e recebe o foco quando a URL
 * chega com `ok=` ou depois de uma ação que tira a linha da lista. Módulo puro: o servidor usa o id, o cliente o foco.
 */
export const ID_TITULO = 'titulo-financeiro';

/**
 * Foca o primeiro dos `alvos` que está na tela (padrão: o h1 do Financeiro). A seção "Cobrança" da tela da consulta passa
 * o próprio h2 e, se a seção saiu, o h1 da consulta.
 */
export function focarTitulo(alvos: readonly string[] = [ID_TITULO]): void {
  for (const id of alvos) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      return;
    }
  }
}
