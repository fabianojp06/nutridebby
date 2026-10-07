import { LIMITE_PAGINAS, type GeoIA, type ModeloIA } from './constantes';
import type { UsoTokens } from './provedor';

/**
 * Spec v0.3 §6 / RNF-109: tabela versionada (US$ por milhão de tokens). 1 token × US$ 1/M = 1 micro-dólar: o custo em
 * micro-dólares é a soma tokens × preço, arredondada para cima. Mudou o preço: nova data aqui e conferência na fatura.
 */
export const PRECOS_IA_DATA = '2026-10-06';
export const PRECOS_IA: Record<ModeloIA, { entrada: number; saida: number; cacheGravacao: number; cacheLeitura: number }> = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheGravacao: 5, cacheLeitura: 0.2 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheGravacao: 2.5, cacheLeitura: 0.2 },
};
/** `inference_geo: "us"` custa 1,1× em todas as categorias (modelos 4.6+). */
export const MULTIPLICADOR_GEO: Record<GeoIA, number> = { us: 1.1, global: 1 };

/** RN-104: teto por página de PDF (3.000 × 1,3 de texto + 4.784 da imagem da página), por foto e das instruções + schema. */
export const TOKENS_POR_PAGINA_TETO = 8700;
export const TOKENS_POR_IMAGEM_TETO = 4784;
export const TOKENS_INSTRUCOES_TETO = 3000;
/** D11: saída + raciocínio da leitura; sem streaming, cabe no timeout de 120 s. */
export const MAX_TOKENS_LEITURA = 16_000;

const geoDe = (g: string | null | undefined, padrao: GeoIA): GeoIA => (g === 'us' || g === 'global' ? g : padrao);

export function custoMicroUsd(modelo: ModeloIA, geo: GeoIA, uso: UsoTokens): number {
  const p = PRECOS_IA[modelo];
  const bruto = uso.entrada * p.entrada + uso.cacheLeitura * p.cacheLeitura + uso.cacheGravacao * p.cacheGravacao + uso.saida * p.saida;
  return Math.ceil(bruto * MULTIPLICADOR_GEO[geoDe(uso.geo, geo)]);
}

export function custoMaximoMicroUsd(modelo: ModeloIA, geo: GeoIA, tokensEntrada: number, maxTokens: number): number {
  const p = PRECOS_IA[modelo];
  return Math.ceil((tokensEntrada * p.entrada + maxTokens * p.saida) * MULTIPLICADOR_GEO[geo]);
}

/** RN-104: a estimativa dos tokens de entrada pelas páginas (ou pela imagem) + instruções — a avaliação mede o real contra ela. */
export function tokensEntradaTeto(arquivo: { tipo: 'pdf'; paginas: number } | { tipo: 'imagem' }): number {
  return (arquivo.tipo === 'pdf' ? arquivo.paginas * TOKENS_POR_PAGINA_TETO : TOKENS_POR_IMAGEM_TETO) + TOKENS_INSTRUCOES_TETO;
}

/** RN-104 (worker, portão do envio, e avaliação): o teto pelas páginas contadas no preparo — sem count_tokens (D2/D4). */
export function custoMaximoDoArquivo(modelo: ModeloIA, geo: GeoIA, arquivo: { tipo: 'pdf'; paginas: number } | { tipo: 'imagem' }): number {
  return custoMaximoMicroUsd(modelo, geo, tokensEntradaTeto(arquivo), MAX_TOKENS_LEITURA);
}

/** RN-104 (app): o teto da tarefa sem abrir o arquivo (D2) — o PDF pelo limite de páginas. */
export function reservaDaLeitura(modelo: ModeloIA, geo: GeoIA, arquivo: 'pdf' | 'imagem'): number {
  return custoMaximoDoArquivo(modelo, geo, arquivo === 'pdf' ? { tipo: 'pdf', paginas: LIMITE_PAGINAS } : { tipo: 'imagem' });
}
