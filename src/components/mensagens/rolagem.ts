/**
 * Rodada da T7 (I3): leva a conversa até o fim — a última mensagem logo acima do rodapé `sticky`. O `scrollIntoView` no
 * próprio rodapé não rola (grudado embaixo, ele já conta como visível); a janela rola até a altura do documento. Painel e
 * portal (a página não tem contêiner de rolagem próprio).
 */
export function rolarAteOFim(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}
