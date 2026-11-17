/**
 * RN-235 (Plano 19, D9): catálogo único dos micronutrientes (`foods.micros`, congelados do plano, perfis de referência,
 * busca por nutriente). Uma chave nova é mudança de código com teste. Sem imports `@/`: o schema do Drizzle
 * (`src/db/schema/plano-alimentar.ts`, `NutrientesCongelados`) importa o tipo daqui com caminho relativo.
 */
import { casasDecimais, formatarDecimal } from '../../lib/numero';
import type { Fonte } from './fontes';

export type UnidadeNutriente = 'g' | 'mg' | 'mcg' | '%';
export type Nutriente = { chave: string; nome: string; unidade: UnidadeNutriente; casas: number; fontes: Fonte[] };

const TACO_USDA: Fonte[] = ['taco', 'usda'];
const USDA: Fonte[] = ['usda'];

/**
 * `fontes` = tabelas públicas cujo seed traz a chave (o "Meu alimento" aceita qualquer chave do catálogo). As 20 da TACO
 * vêm primeiro, na ordem de `CAMPOS_MICRO` (`taco.ts`, colunas da planilha — não mudam); depois as 11 que só a USDA traz.
 * Exibição: g e mg com 1 casa, mcg sem casa, % com 1 casa.
 */
export const NUTRIENTES = [
  { chave: 'umidade_pct', nome: 'Umidade', unidade: '%', casas: 1, fontes: TACO_USDA },
  { chave: 'colesterol_mg', nome: 'Colesterol', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'cinzas_g', nome: 'Cinzas', unidade: 'g', casas: 1, fontes: TACO_USDA },
  { chave: 'calcio_mg', nome: 'Cálcio', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'magnesio_mg', nome: 'Magnésio', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'manganes_mg', nome: 'Manganês', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'fosforo_mg', nome: 'Fósforo', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'ferro_mg', nome: 'Ferro', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'sodio_mg', nome: 'Sódio', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'potassio_mg', nome: 'Potássio', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'cobre_mg', nome: 'Cobre', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'zinco_mg', nome: 'Zinco', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'retinol_mcg', nome: 'Retinol', unidade: 'mcg', casas: 0, fontes: TACO_USDA },
  // RE (equivalente de retinol) é coluna da TACO; a USDA traz só RAE em µg
  { chave: 're_mcg', nome: 'Vitamina A (RE)', unidade: 'mcg', casas: 0, fontes: ['taco'] },
  { chave: 'rae_mcg', nome: 'Vitamina A (RAE)', unidade: 'mcg', casas: 0, fontes: TACO_USDA },
  { chave: 'tiamina_mg', nome: 'Tiamina (B1)', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'riboflavina_mg', nome: 'Riboflavina (B2)', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'piridoxina_mg', nome: 'Piridoxina (B6)', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'niacina_mg', nome: 'Niacina (B3)', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'vitamina_c_mg', nome: 'Vitamina C', unidade: 'mg', casas: 1, fontes: TACO_USDA },
  { chave: 'vitamina_d_mcg', nome: 'Vitamina D', unidade: 'mcg', casas: 0, fontes: USDA },
  { chave: 'vitamina_b12_mcg', nome: 'Vitamina B12', unidade: 'mcg', casas: 0, fontes: USDA },
  { chave: 'folato_dfe_mcg', nome: 'Folato (DFE)', unidade: 'mcg', casas: 0, fontes: USDA },
  { chave: 'vitamina_e_mg', nome: 'Vitamina E', unidade: 'mg', casas: 1, fontes: USDA },
  { chave: 'vitamina_k_mcg', nome: 'Vitamina K', unidade: 'mcg', casas: 0, fontes: USDA },
  { chave: 'selenio_mcg', nome: 'Selênio', unidade: 'mcg', casas: 0, fontes: USDA },
  { chave: 'acucares_g', nome: 'Açúcares totais', unidade: 'g', casas: 1, fontes: USDA },
  { chave: 'gordura_saturada_g', nome: 'Gordura saturada', unidade: 'g', casas: 1, fontes: USDA },
  { chave: 'gordura_mono_g', nome: 'Gordura monoinsaturada', unidade: 'g', casas: 1, fontes: USDA },
  { chave: 'gordura_poli_g', nome: 'Gordura poli-insaturada', unidade: 'g', casas: 1, fontes: USDA },
  { chave: 'gordura_trans_g', nome: 'Gordura trans', unidade: 'g', casas: 1, fontes: USDA },
] as const satisfies readonly Nutriente[];

export type ChaveNutriente = (typeof NUTRIENTES)[number]['chave'];

const POR_CHAVE = new Map<string, (typeof NUTRIENTES)[number]>(NUTRIENTES.map((n) => [n.chave, n]));

export const ehChaveNutriente = (k: unknown): k is ChaveNutriente => typeof k === 'string' && POR_CHAVE.has(k);

/** US-231: faixa aceita em `foods.micros` (valor por 100 g). */
export const MICRO_MAX = 100000;

const SIMBOLO: Record<UnidadeNutriente, string> = { g: ' g', mg: ' mg', mcg: ' µg', '%': '%' };

/** RN-235: "120,0 mg", "2 µg", "68,2%" (vírgula decimal, RNF-12). */
export function formatarNutriente(chave: ChaveNutriente, valor: number): string {
  const n = POR_CHAVE.get(chave)!;
  return `${formatarDecimal(valor, n.casas)}${SIMBOLO[n.unidade]}`;
}

/**
 * RN-239: meta e máximo do perfil como foram digitados, sem zeros à direita e no máximo com as casas do catálogo
 * ("18 mg", "0,9 mg", "400 µg"); o total do plano usa `formatarNutriente` ("12,4 mg").
 */
export function formatarReferencia(chave: ChaveNutriente, valor: number): string {
  const n = POR_CHAVE.get(chave)!;
  return `${formatarDecimal(valor, Math.min(casasDecimais(valor), n.casas))}${SIMBOLO[n.unidade]}`;
}

/** RN-259: textos dos micronutrientes do "Meu alimento" (US-231, §5 da spec). */
export const MSG_NUTRIENTES = {
  secao: 'Micronutrientes (opcional)',
  faixa: 'Use um número de 0 a 100000.',
  /** Chave fora do catálogo ou micros fora do formato: o formulário nunca manda, só uma entrada adulterada. */
  desconhecido: 'Formulário inválido.',
  /** US-233 (RN-239): a seção do editor do plano. */
  doPaciente: 'Nutrientes do paciente',
  perfil: 'Perfil de referência',
  semPerfil: 'Sem perfil',
  verTodos: 'Ver todos os nutrientes',
  mostrarNoPdf: 'Mostrar no PDF os nutrientes escolhidos',
  ligueCalorias: 'Ligue antes "Mostrar calorias ao paciente".',
  limite: 'Escolha até 12 nutrientes.', // MAX_NUTRIENTES_EXIBIDOS
  acimaDoMaximo: (valor: string) => `Acima do máximo (${valor})`,
  /** RN-237: plano publicado antes do Plano 19 (o congelado não tem micros). */
  naoRegistrados: 'Micronutrientes não registrados nesta versão do plano.',
  /** RN-236: "2 itens sem valor de ferro"; 1 item: "1 item sem valor de ferro". */
  semValorDe: (n: number, nome: string) => `${n} ${n === 1 ? 'item' : 'itens'} sem valor de ${nome.charAt(0).toLowerCase()}${nome.slice(1)}`,
} as const;

/** Unidade como a tela mostra no rótulo do campo ("Cálcio (mg)", "Vitamina D (µg)", "Umidade (%)"). */
export const UNIDADE_NA_TELA: Record<UnidadeNutriente, string> = { g: 'g', mg: 'mg', mcg: 'µg', '%': '%' };

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `foods.micros` lido do banco (ou de uma cópia): só as chaves do catálogo, com número ou `null`; o resto sai. O que não é
 * objeto vira `{}`.
 */
export function microsDoCatalogo(m: unknown): Partial<Record<ChaveNutriente, number | null>> {
  const out: Partial<Record<ChaveNutriente, number | null>> = {};
  if (!objeto(m)) return out;
  for (const [k, v] of Object.entries(m)) {
    if (!ehChaveNutriente(k)) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * `foods.micros` (RN-235): só chaves do catálogo, número de 0 a 100000 por 100 g; `null` = sem valor (fica fora do
 * resultado). Recusa devolve a primeira chave errada (para o erro ao lado do campo); o que não é objeto, chave vazia.
 */
export function microsValidos(m: unknown): { ok: true; valor: Partial<Record<ChaveNutriente, number>> } | { ok: false; chave: string } {
  if (!objeto(m)) return { ok: false, chave: '' };
  const valor: Partial<Record<ChaveNutriente, number>> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!ehChaveNutriente(k)) return { ok: false, chave: k };
    if (v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MICRO_MAX) return { ok: false, chave: k };
    valor[k] = v;
  }
  return { ok: true, valor };
}
