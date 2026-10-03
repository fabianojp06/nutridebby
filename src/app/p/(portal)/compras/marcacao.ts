/**
 * RN-13 / D15: "comprado" fica no aparelho (localStorage), por plano: plano novo, lista nova.
 * Sem armazenamento (dados de site bloqueados, WebView sem storage, cota cheia), a marcação
 * vale enquanto a tela estiver aberta: a cópia em memória do módulo responde no lugar dele.
 */
export const EVENTO_COMPRAS = 'nd-compras';

/** Só guarda a chave quando o localStorage recusou a gravação; com ele funcionando, fica vazia. */
const memoria = new Map<string, string>();

const PREFIXO = 'nd-compras:';
/** De quem são as marcações deste aparelho (o paciente do vínculo, como o dono do plano guardado). */
const CHAVE_DONO = 'nd-compras-dono';

export const chaveCompras = (planoId: string) => `${PREFIXO}${planoId}`;

/**
 * Review Focus 4 (aparelho compartilhado): as marcações levam nomes de alimentos do plano. Saem com o plano guardado — no
 * "Sair", no /entrar e na troca de dono — também no Safari < 17, que não aplica o "storage" do Clear-Site-Data.
 */
export function esquecerComprasDoAparelho(): void {
  memoria.clear();
  try {
    const chaves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && (k.startsWith(PREFIXO) || k === CHAVE_DONO)) chaves.push(k);
    }
    for (const k of chaves) localStorage.removeItem(k);
  } catch {
    // sem armazenamento: só havia a cópia em memória
  }
}

/** Layout do portal: marcações de outra conta ou de outro vínculo saem (o par do conferirDono do service worker). */
export function conferirDonoDasCompras(dono: string): void {
  try {
    if (localStorage.getItem(CHAVE_DONO) === dono) return;
    esquecerComprasDoAparelho();
    localStorage.setItem(CHAVE_DONO, dono);
  } catch {
    // sem armazenamento: as marcações só vivem na memória desta tela
  }
}

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
