import type { GeoIA, ModeloIA } from './constantes';

/**
 * Plano 11 (spec v0.3 §5.1, A-D1): a interface que isola o provedor. Nada aqui importa SDK: o app pode importar os tipos;
 * só `provedor-anthropic.ts` importa `@anthropic-ai/sdk` (RNF-103). Trocar de provedor (UE, se o advogado preferir) é
 * escrever outra implementação.
 */
export type ArquivoPreparado = { tipo: 'pdf'; base64: string; paginas: number } | { tipo: 'imagem'; base64: string };

export type PedidoLeitura = {
  modelo: ModeloIA;
  geo: GeoIA;
  /** Instruções fixas versionadas (instrucoes/leitura.ts). */
  sistema: string;
  instrucao: string;
  arquivo: ArquivoPreparado;
  /** JSON Schema fixo do código — nunca com dado do paciente (o provedor guarda o schema compilado por 24 h). */
  schema: Record<string, unknown>;
  maxTokens: number;
  esforco: 'low' | 'medium';
};

export type UsoTokens = { entrada: number; cacheLeitura: number; cacheGravacao: number; saida: number; geo: string | null };

export type RespostaLeitura = ({ tipo: 'ok'; texto: string } | { tipo: 'recusa'; categoria: string | null } | { tipo: 'cortada' }) & {
  uso: UsoTokens;
  /** `request-id` do provedor: pode ir para o log (spec §5.7). */
  requestId: string | null;
};

/**
 * D4 / RN-105: o que o worker faz com cada falha. `nao_enviado` e `repetir` → nova tentativa pelo pg-boss; `incerto` →
 * resultado incerto (o provedor pode ter cobrado); o resto termina a tarefa.
 */
export type TipoErroProvedor = 'nao_enviado' | 'repetir' | 'incerto' | 'credencial' | 'limite_de_gasto' | 'grande_demais' | 'pedido_invalido';

/** O único erro que sai de um provedor: tipo, status e request-id — nunca o texto do provedor, que pode ecoar o pedido. */
export class ErroProvedor extends Error {
  override name = 'ErroProvedor';
  constructor(
    readonly tipo: TipoErroProvedor,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(`provedor de IA: ${tipo}${status ? ` (${status})` : ''}`);
  }
}

export interface ProvedorIA {
  readonly nome: 'anthropic' | 'sandbox' | 'fake';
  // Sem contarTokens (revisão do plano): contar mandaria o laudo ao provedor uma vez a mais, antes do portão do envio.
  // O teto da tarefa sai das páginas (custoMaximoDoArquivo, T7).
  /** Uma chamada; nunca repete sozinho (maxRetries 0); lança ErroProvedor. */
  lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura>;
}
