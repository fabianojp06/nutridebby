/**
 * Correção do E2E "rodada T6b (I4)" (painel e portal): o campo da conversa é UM `textarea`, nunca remontado. Remontá-lo
 * por `key` a cada resposta da action deixava, depois de uma falha de rede, o nó velho (com o rascunho) no formulário ao
 * lado do novo no envio seguinte — o reset automático do formulário pelo React e a troca do nó no mesmo commit —, e o campo
 * "não limpava". Aqui a resposta entra no valor do mesmo `textarea`: no erro, o texto que voltou; no sucesso, vazio.
 * Devolve se a resposta foi um envio gravado (quem chama leva o foco). Puro (o `textarea` entra como parâmetro).
 */
export function aplicarResposta(campo: { value: string } | null, estado: { texto: string; enviada: boolean } | null): boolean {
  if (!campo || !estado) return false;
  campo.value = estado.texto;
  return estado.enviada;
}
