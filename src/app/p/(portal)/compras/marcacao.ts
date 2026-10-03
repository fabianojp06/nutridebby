/**
 * RN-13 / D15: "comprado" fica no aparelho (localStorage), por plano: plano novo, lista nova.
 * Sem armazenamento (dados de site bloqueados, WebView sem storage, cota cheia), a marcação
 * vale enquanto a tela estiver aberta: a cópia em memória do módulo responde no lugar dele.
 */
export const EVENTO_COMPRAS = 'nd-compras';

/** Só guarda a chave quando o localStorage recusou a gravação; com ele funcionando, fica vazia. */
const memoria = new Map<string, string>();

export const chaveCompras = (planoId: string) => `nd-compras:${planoId}`;

export function assinarCompras(cb: () => void): () => void {
  window.addEventListener(EVENTO_COMPRAS, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO_COMPRAS, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Snapshot do useSyncExternalStore: texto (comparado por valor), nunca lança. */
export function lerBruto(chave: string): string {
  const emMemoria = memoria.get(chave);
  if (emMemoria !== undefined) return emMemoria;
  try {
    return localStorage.getItem(chave) ?? '[]';
  } catch {
    return '[]';
  }
}

export function lerComprados(bruto: string): string[] {
  try {
    const v: unknown = JSON.parse(bruto);
    return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

export function alternarComprado(chave: string, nome: string): void {
  const atuais = lerComprados(lerBruto(chave));
  const novos = atuais.includes(nome) ? atuais.filter((n) => n !== nome) : [...atuais, nome];
  const bruto = JSON.stringify(novos);
  try {
    localStorage.setItem(chave, bruto);
    memoria.delete(chave);
  } catch {
    memoria.set(chave, bruto);
  }
  window.dispatchEvent(new Event(EVENTO_COMPRAS));
}
