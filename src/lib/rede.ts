/** Erros de rede da fase de conexão (recusada, DNS, rota): o pedido não chegou a sair, repetir não duplica. */
const ANTES_DE_ENVIAR = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

const codigos = (e: unknown): unknown[] => {
  const x = e as { code?: unknown; errors?: unknown } | null;
  return Array.isArray(x?.errors) ? x.errors.map((y: { code?: unknown } | null) => y?.code) : [x?.code];
};

/**
 * D6 (WhatsApp e push no máximo uma vez): a chamada HTTP falhou antes de o pedido sair? Lê o `code` da `cause` (fetch/
 * undici) ou do próprio erro (node:https, usado pelo web-push) — ou o de cada erro do AggregateError, quando o nome
 * resolve para IPv4 e IPv6. Qualquer outra falha — conexão derrubada depois de enviar (ECONNRESET, UND_ERR_SOCKET),
 * timeout, erro sem código — pode ter sido aceita do outro lado: não repete.
 */
export function pedidoNaoSaiu(err: unknown): boolean {
  const causa = (err as { cause?: unknown } | null)?.cause;
  const cs = codigos(causa ?? err);
  return cs.length > 0 && cs.every((c) => typeof c === 'string' && ANTES_DE_ENVIAR.has(c));
}
