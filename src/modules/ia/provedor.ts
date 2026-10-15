import type { DestinoIA, FinalidadeIA, ModeloIA, RegiaoIA } from './constantes';

/**
 * Plano 11 (spec v0.3 §5.1, A-D1): a interface que isola o provedor. Nada aqui importa SDK: o app pode importar os tipos;
 * só `provedor-anthropic.ts` importa `@anthropic-ai/sdk` (RNF-103). Trocar de provedor (UE, se o advogado preferir) é
 * escrever outra implementação.
 */
export type ArquivoPreparado = { tipo: 'pdf'; base64: string; paginas: number } | { tipo: 'imagem'; base64: string };

export type PedidoLeitura = {
  modelo: ModeloIA;
  /** A região efetiva (D5): `us`/`global` na API direta; `eu` no Bedrock (a região vem do perfil; nunca vai como parâmetro). */
  geo: RegiaoIA;
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
 * Plano 14B (D1): uma chamada de `gerar` — o resumo (sem ferramentas), e cada volta do laço de ferramentas do rascunho e
 * dos modelos. Sem SDK aqui. Os turnos do assistente levam o conteúdo BRUTO que o provedor devolveu (texto, ferramentas e
 * os blocos de raciocínio com a assinatura), reenviado sem nenhuma mudança: o histórico é só de inclusão ("preserved
 * thinking" dos modelos 5.5: editar um turno anterior invalida o raciocínio e pode dar 400).
 */
export type FerramentaIA = { nome: string; descricao: string; schema: Record<string, unknown> };
export type BlocoDoUsuario = { tipo: 'texto'; texto: string } | { tipo: 'resultado'; chamadaId: string; conteudo: string; erro?: true };
export type TurnoIA = { papel: 'usuario'; blocos: readonly BlocoDoUsuario[] } | { papel: 'assistente'; bruto: readonly unknown[] };
export type PedidoGeracao = {
  finalidade: FinalidadeIA;
  modelo: ModeloIA;
  geo: RegiaoIA;
  /** Instruções fixas versionadas (instrucoes/*.ts) — nunca com dado de paciente. */
  sistema: string;
  turnos: readonly TurnoIA[];
  /** Vazio = sem ferramentas (resumo). Com ferramentas: strict e tool_choice auto (forçado → 400 nos 5.5). */
  ferramentas: readonly FerramentaIA[];
  /** JSON Schema da resposta final (output_config.format) — fixo do código, sem dado de paciente. */
  schema: Record<string, unknown>;
  maxTokens: number;
  esforco: 'low' | 'medium';
  /** Plano 15 (RN-180): prazo desta chamada (a IA Nutri: 45 s); sem ele, o do cliente (120 s). */
  prazoMs?: number;
};
export type ChamadaFerramenta = { id: string; nome: string; entrada: unknown };
export type RespostaGeracao = (
  | { tipo: 'final'; texto: string }
  | { tipo: 'ferramentas'; chamadas: ChamadaFerramenta[] }
  | { tipo: 'recusa'; categoria: string | null }
  | { tipo: 'cortada' }
) & { bruto: readonly unknown[]; uso: UsoTokens; requestId: string | null };

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
  readonly nome: 'anthropic' | 'bedrock-eu' | 'sandbox' | 'fake';
  /** RN-109: o destino que o portão do envio grava na tarefa e que a autorização do paciente precisa ter. */
  readonly destino: DestinoIA;
  /** D4 / R-116: o tamanho máximo do pedido inteiro (base64 + instruções); o preparo recusa antes do portão. */
  readonly limitePedidoBytes: number;
  /**
   * D3/D5 (Plano 14A, revisão da T3): se este provedor atende o modelo na região. O job confere ANTES do portão do envio
   * (passo 2): pedido que o provedor recusaria localmente nunca vira `saiu_em` nem "Laudo enviado à IA". A guarda dentro de
   * `lerDocumento` fica como defesa a mais.
   */
  aceita(modelo: ModeloIA, geo: RegiaoIA): boolean;
  // Sem contarTokens (revisão do plano): contar mandaria o laudo ao provedor uma vez a mais, antes do portão do envio.
  // O teto da tarefa sai das páginas (custoMaximoDoArquivo, T7).
  /** Uma chamada; nunca repete sozinho (maxRetries 0); lança ErroProvedor. */
  lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura>;
  /** Plano 14B: uma chamada; nunca repete sozinho (maxRetries 0); lança ErroProvedor. O laço fica no worker (laco-ferramentas.ts). */
  gerar(p: PedidoGeracao): Promise<RespostaGeracao>;
}
