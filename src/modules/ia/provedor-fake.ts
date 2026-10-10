import type { ModeloIA, RegiaoIA } from './constantes';
import { ErroProvedor, type PedidoGeracao, type PedidoLeitura, type ProvedorIA, type RespostaGeracao, type RespostaLeitura, type UsoTokens } from './provedor';
import { provedorSandbox } from './provedor-sandbox';

export const USO_FAKE: UsoTokens = { entrada: 10_000, cacheLeitura: 0, cacheGravacao: 0, saida: 1_000, geo: 'us' };

/** Resposta "ok" com o JSON dado (para o roteiro do provedor falso). */
export function respostaOk(json: unknown, uso: UsoTokens = USO_FAKE): RespostaLeitura {
  return { tipo: 'ok', texto: typeof json === 'string' ? json : JSON.stringify(json), uso, requestId: 'fake-req' };
}

/** Resposta final ou pedido de ferramentas para o roteiro do fake (Plano 14B). */
export const finalOk = (json: unknown, uso: UsoTokens = USO_FAKE): RespostaGeracao => {
  const texto = typeof json === 'string' ? json : JSON.stringify(json);
  return { tipo: 'final', texto, bruto: [{ type: 'text', text: texto }], uso, requestId: 'fake-req' };
};
export const pedeFerramenta = (nome: string, entrada: unknown, id = `fake-${nome}`, uso: UsoTokens = USO_FAKE): RespostaGeracao => ({
  tipo: 'ferramentas', chamadas: [{ id, nome, entrada }], bruto: [{ type: 'tool_use', id, name: nome, input: entrada }], uso, requestId: 'fake-req',
});

type Passo<T> = T | ErroProvedor | Error;
export type RoteiroFake = {
  ler?: Passo<RespostaLeitura>[];
  /** Plano 14B: as respostas de cada chamada de `gerar`, na ordem. */
  gerar?: Passo<RespostaGeracao>[];
  atrasoMs?: number;
  /** D4: o limite do pedido do provedor simulado (padrão: o da API direta). */
  limitePedidoBytes?: number;
  /** D3/D5: o que o provedor simulado atende (padrão: tudo). */
  aceita?: (modelo: ModeloIA, geo: RegiaoIA) => boolean;
};
export type ProvedorFake = ProvedorIA & { chamadas: { ler: PedidoLeitura[]; gerar: PedidoGeracao[] } };

/**
 * Provedor programável dos testes (spec §9: "provedor falso em todo teste"). Cada chamada consome o próximo passo do
 * roteiro; sem roteiro, devolve o sandbox. Erros do roteiro são lançados como vierem (ErroProvedor ou um Error qualquer,
 * para testar o caminho de erro desconhecido).
 */
export function provedorFake(roteiro: RoteiroFake = {}): ProvedorFake {
  const sandbox = provedorSandbox();
  const chamadas = { ler: [] as PedidoLeitura[], gerar: [] as PedidoGeracao[] };
  const ler = [...(roteiro.ler ?? [])];
  const gerar = [...(roteiro.gerar ?? [])];
  const esperar = () => (roteiro.atrasoMs ? new Promise((r) => setTimeout(r, roteiro.atrasoMs)) : Promise.resolve());
  return {
    nome: 'fake',
    destino: 'teste',
    limitePedidoBytes: roteiro.limitePedidoBytes ?? 32 * 1024 * 1024,
    aceita: roteiro.aceita ?? (() => true),
    chamadas,
    async lerDocumento(p) {
      chamadas.ler.push(p);
      await esperar();
      const passo = ler.shift();
      if (passo instanceof Error) throw passo;
      return passo ?? sandbox.lerDocumento(p);
    },
    async gerar(p) {
      chamadas.gerar.push(p);
      await esperar();
      const passo = gerar.shift();
      if (passo instanceof Error) throw passo;
      return passo ?? sandbox.gerar(p);
    },
  };
}

export { ErroProvedor };
