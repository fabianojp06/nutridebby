import { LIMITE_PAGINAS, type ModeloIA, type RegiaoIA } from './constantes';
import type { UsoTokens } from './provedor';

/**
 * Spec v0.3 §6 / RNF-109: tabela versionada (US$ por milhão de tokens). 1 token × US$ 1/M = 1 micro-dólar: o custo em
 * micro-dólares é a soma tokens × preço, arredondada para cima. Mudou o preço: nova data aqui e conferência na fatura.
 */
// Plano 15 (D5): Haiku 5.5 — US$ 0,10 / 0,50 por milhão (referência da API, conferida em 09/10/2026, §8 da spec); cache
// 1,25× e 0,1× da entrada, como os outros, sem uso (D35)
export const PRECOS_IA_DATA = '2026-10-09';
// Plano 14A (R-117): a tabela vale também para o Bedrock até o dono conferir a página de preços da AWS — runbook, passo 3
export const PRECOS_IA: Record<ModeloIA, { entrada: number; saida: number; cacheGravacao: number; cacheLeitura: number }> = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheGravacao: 5, cacheLeitura: 0.2 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheGravacao: 2.5, cacheLeitura: 0.2 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheGravacao: 0.125, cacheLeitura: 0.01 },
};
/** `inference_geo: "us"` custa 1,1× (modelos 4.6+); o perfil geográfico `eu.` do Bedrock tem o prêmio de 10% do endpoint regional (§5.5). */
export const MULTIPLICADOR_GEO: Record<RegiaoIA, number> = { us: 1.1, global: 1, eu: 1.1 };

/** RN-104: teto por página de PDF (3.000 × 1,3 de texto + 4.784 da imagem da página), por foto e das instruções + schema. */
export const TOKENS_POR_PAGINA_TETO = 8700;
export const TOKENS_POR_IMAGEM_TETO = 4784;
export const TOKENS_INSTRUCOES_TETO = 3000;
/** D11: saída + raciocínio da leitura; sem streaming, cabe no timeout de 120 s. */
export const MAX_TOKENS_LEITURA = 16_000;
/** Plano 14B (D2): saída + raciocínio de cada volta do laço e do resumo — sem streaming, dentro do timeout de 120 s. */
export const MAX_TOKENS_VOLTA = 16_000;
export const MAX_TOKENS_RESUMO = 8_000;
/**
 * Plano 15 (DP-8, §8): o teto da pergunta da IA Nutri — plano + 5 orientações de até 5.000 caracteres + 6 mensagens +
 * instruções, com folga para o tokenizador do Haiku 5.5 (≈ 30% mais tokens); saída = {categoria, tipo_resposta, fontes} +
 * o raciocínio de esforço `low` (D31). O portão desce a reserva pelo pedido montado.
 */
export const TOKENS_ENTRADA_TETO_CONVERSA = 40_000;
export const MAX_TOKENS_CONVERSA = 2_000;
/** D5/D12: estimativa conservadora de tokens de um texto já montado (2 bytes UTF-8 por token; o português dá ≈ 4). */
export const tokensDeBytes = (bytes: number): number => Math.ceil(bytes / 2);

const geoDe = (g: string | null | undefined, padrao: RegiaoIA): RegiaoIA => (g === 'us' || g === 'global' || g === 'eu' ? g : padrao);

export function custoMicroUsd(modelo: ModeloIA, geo: RegiaoIA, uso: UsoTokens): number {
  const p = PRECOS_IA[modelo];
  const bruto = uso.entrada * p.entrada + uso.cacheLeitura * p.cacheLeitura + uso.cacheGravacao * p.cacheGravacao + uso.saida * p.saida;
  return Math.ceil(bruto * MULTIPLICADOR_GEO[geoDe(uso.geo, geo)]);
}

export function custoMaximoMicroUsd(modelo: ModeloIA, geo: RegiaoIA, tokensEntrada: number, maxTokens: number): number {
  const p = PRECOS_IA[modelo];
  return Math.ceil((tokensEntrada * p.entrada + maxTokens * p.saida) * MULTIPLICADOR_GEO[geo]);
}

/** RN-104: a estimativa dos tokens de entrada pelas páginas (ou pela imagem) + instruções — a avaliação mede o real contra ela. */
export function tokensEntradaTeto(arquivo: { tipo: 'pdf'; paginas: number } | { tipo: 'imagem' }): number {
  return (arquivo.tipo === 'pdf' ? arquivo.paginas * TOKENS_POR_PAGINA_TETO : TOKENS_POR_IMAGEM_TETO) + TOKENS_INSTRUCOES_TETO;
}

/** RN-104 (worker, portão do envio, e avaliação): o teto pelas páginas contadas no preparo — sem count_tokens (D2/D4). */
export function custoMaximoDoArquivo(modelo: ModeloIA, geo: RegiaoIA, arquivo: { tipo: 'pdf'; paginas: number } | { tipo: 'imagem' }): number {
  return custoMaximoMicroUsd(modelo, geo, tokensEntradaTeto(arquivo), MAX_TOKENS_LEITURA);
}

/** RN-104 (app): o teto da tarefa sem abrir o arquivo (D2) — o PDF pelo limite de páginas. */
export function reservaDaLeitura(modelo: ModeloIA, geo: RegiaoIA, arquivo: 'pdf' | 'imagem'): number {
  return custoMaximoDoArquivo(modelo, geo, arquivo === 'pdf' ? { tipo: 'pdf', paginas: LIMITE_PAGINAS } : { tipo: 'imagem' });
}
