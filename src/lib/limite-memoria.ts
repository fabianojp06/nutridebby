export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo em alguns minutos.';

/**
 * Janela fixa por chave, em memória do processo (D10). Correto com 1 réplica do app — escalar para 2+ réplicas muda o
 * limite (anotado no fechamento). Uma varredura das chaves vencidas por janela: o mapa não cresce sem fim.
 */
export function criarLimite(o: { janelaMs: number; max: number }) {
  const baldes = new Map<string, { inicio: number; n: number }>();
  let ultimaVarredura = 0;
  return {
    permitir(chave: string, agora: number = Date.now()): boolean {
      if (agora - ultimaVarredura >= o.janelaMs) {
        for (const [k, b] of baldes) if (agora - b.inicio >= o.janelaMs) baldes.delete(k);
        ultimaVarredura = agora;
      }
      const b = baldes.get(chave);
      if (!b || agora - b.inicio >= o.janelaMs) {
        baldes.set(chave, { inicio: agora, n: 1 });
        return true;
      }
      if (b.n >= o.max) return false;
      b.n++;
      return true;
    },
    tamanho: () => baldes.size,
  };
}
