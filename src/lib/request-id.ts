/** RNF-11 (D2): id por requisição, gerado no proxy (sobrescreve o do cliente) e devolvido em `x-request-id`. */
export const CABECALHO_REQUEST_ID = 'x-request-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const novoRequestId = (): string => crypto.randomUUID();

/** O id que o proxy gravou (formato conferido: nunca entra no log um valor arbitrário). */
export function requestIdDe(v: string | string[] | null | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && UUID_V4.test(s) ? s : null;
}
