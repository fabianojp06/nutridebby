/**
 * RN-241/RN-242 (Plano 19, US-234): critérios, textos e formatação do diálogo "Buscar alimento" (abas Nutrientes e
 * Equivalentes). Sem banco: o diálogo (cliente), a busca do servidor e as rotas importam daqui. Texto exato da spec
 * (§4.3, §5, §6.1) quando existe.
 */
import { formatarDecimal } from '../../lib/numero';
import type { Nutrientes100 } from './busca';
import { FONTES_DE_ALIMENTO, type Fonte } from './fontes';
import { ehGrupo } from './grupos';
import { ehChaveNutriente, formatarNutriente, NUTRIENTES, type ChaveNutriente } from './nutrientes';

/** RN-241: os macros que também servem de critério (colunas de `foods`, valor por 100 g). */
export const MACROS_DO_CRITERIO = ['kcal', 'proteinaG', 'carboidratoG', 'lipidioG', 'fibraG'] as const;
export type MacroDoCriterio = (typeof MACROS_DO_CRITERIO)[number];
/** Chave da busca por nutriente e do "Igualar por": um macro ou uma chave do catálogo (RN-235). */
export type ChaveDoCriterio = MacroDoCriterio | ChaveNutriente;
export type Direcao = 'rico' | 'pobre';
export const DIRECOES: readonly Direcao[] = ['rico', 'pobre'];

const NOME_MACRO: Record<MacroDoCriterio, string> = { kcal: 'Energia', proteinaG: 'Proteína', carboidratoG: 'Carboidrato', lipidioG: 'Lipídio', fibraG: 'Fibra' };
const UNIDADE_MACRO: Record<MacroDoCriterio, string> = { kcal: 'kcal', proteinaG: 'g', carboidratoG: 'g', lipidioG: 'g', fibraG: 'g' };

export const ehMacroDoCriterio = (k: unknown): k is MacroDoCriterio => typeof k === 'string' && (MACROS_DO_CRITERIO as readonly string[]).includes(k);
export const ehChaveDoCriterio = (k: unknown): k is ChaveDoCriterio => ehMacroDoCriterio(k) || ehChaveNutriente(k);
export const ehDirecao = (v: unknown): v is Direcao => v === 'rico' || v === 'pobre';

/** Opções do select (macros primeiro, depois o catálogo na ordem dele). */
export const OPCOES_DO_CRITERIO: { chave: ChaveDoCriterio; nome: string }[] = [
  ...MACROS_DO_CRITERIO.map((chave) => ({ chave, nome: NOME_MACRO[chave] })),
  ...NUTRIENTES.map((n) => ({ chave: n.chave, nome: n.nome })),
];
const NOME = new Map<string, string>(OPCOES_DO_CRITERIO.map((o) => [o.chave, o.nome]));

/** "Ferro", "Energia", "Vitamina C". */
export const nomeDoCriterio = (k: ChaveDoCriterio): string => NOME.get(k)!;
/** No meio da frase: "ferro", "energia", "vitamina C" (só a primeira letra). */
const noMeio = (k: ChaveDoCriterio): string => {
  const n = nomeDoCriterio(k);
  return n.charAt(0).toLowerCase() + n.slice(1);
};

/** Gênero e número para "mesmo carboidrato", "mesma energia", "mesmas cinzas", "mesmos açúcares totais". */
const FEMININOS = new Set<string>([
  'kcal', 'proteinaG', 'fibraG', 'umidade_pct', 're_mcg', 'rae_mcg', 'tiamina_mg', 'riboflavina_mg', 'piridoxina_mg', 'niacina_mg', 'vitamina_c_mg', 'vitamina_d_mcg',
  'vitamina_b12_mcg', 'vitamina_e_mg', 'vitamina_k_mcg', 'gordura_saturada_g', 'gordura_mono_g', 'gordura_poli_g', 'gordura_trans_g',
]);
const mesmo = (k: ChaveDoCriterio): string => {
  if (k === 'cinzas_g') return 'mesmas';
  if (k === 'acucares_g') return 'mesmos';
  return FEMININOS.has(k) ? 'mesma' : 'mesmo';
};

/** Valor por 100 g do alimento no critério (nulo = sem valor na fonte). */
export function valorPorCem(a: { porCem: Nutrientes100; micros: Partial<Record<ChaveNutriente, number | null>> }, k: ChaveDoCriterio): number | null {
  return ehMacroDoCriterio(k) ? a.porCem[k] : (a.micros[k] ?? null);
}

/** "154 kcal", "2,5 g", "1,6 mg", "12 µg" (RN-235, RNF-12). */
export function formatarCriterio(k: ChaveDoCriterio, v: number): string {
  if (!ehMacroDoCriterio(k)) return formatarNutriente(k, v);
  return `${formatarDecimal(v, k === 'kcal' ? 0 : 1)} ${UNIDADE_MACRO[k]}`;
}

/** RN-241: "Ordenado por ferro em 100 g (maior primeiro)." / "(menor primeiro)." */
export const criterioDoNutriente = (k: ChaveDoCriterio, d: Direcao): string => `Ordenado por ${noMeio(k)} em 100 g (${d === 'rico' ? 'maior' : 'menor'} primeiro).`;

/**
 * RN-242 (US-234): "Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína,
 * carboidrato e lipídio." / "Mesmo grupo (Cereais e derivados) · mesmo carboidrato · energia até ±10%."
 */
export function criterioDosEquivalentes(grupo: string, k: ChaveDoCriterio): string {
  const base = `Mesmo grupo (${grupo}) · ${mesmo(k)} ${noMeio(k)}`;
  return k === 'kcal' ? `${base} · ordenados pela proximidade de proteína, carboidrato e lipídio.` : `${base} · energia até ±10%.`;
}

/**
 * Filtros das rotas de busca (`fonte`, que pode repetir, e `grupo`): sem filtro = todas as fontes e grupos. Valor
 * desconhecido = `null` (a rota responde 400). A TBCA passa aqui e sai em `fontesPermitidas` (RN-232).
 */
export function lerFiltrosDaBusca(p: URLSearchParams): { fontes?: Fonte[]; grupo?: string } | null {
  const fontes = p.getAll('fonte');
  const grupo = p.get('grupo');
  if (!fontes.every((f) => (FONTES_DE_ALIMENTO as readonly string[]).includes(f))) return null;
  if (grupo !== null && !ehGrupo(grupo)) return null;
  return { ...(fontes.length ? { fontes: fontes as Fonte[] } : {}), ...(grupo !== null ? { grupo } : {}) };
}

/** RN-242: a energia do candidato por nutriente fica a até 10% da referência. */
export const TOLERANCIA_ENERGIA = 0.1;

/** RN-259: textos do diálogo "Buscar alimento" (§4.3, §6.1 da spec). */
export const MSG_BUSCA = {
  maisOpcoes: 'Mais opções de busca',
  titulo: 'Buscar alimento',
  abas: { lista: 'Lista', nutrientes: 'Nutrientes', equivalentes: 'Equivalentes' },
  verNutrientes: 'Ver nutrientes',
  adicionar: 'Adicionar',
  comoSubstituicao: 'Adicionar como substituição',
  cadastrar: 'Não encontrou? Cadastrar meu alimento',
  outraAba: '(abre em outra aba)',
  rico: 'Rico em',
  pobre: 'Pobre em',
  igualarPor: 'Igualar por',
  sugestao: 'Sugestão: confira antes de usar.',
  nenhum: 'Nenhum alimento atende a este critério.',
  adicionado: (refeicao: string) => `Adicionado a ${refeicao}.`,
  semItem: 'Para ver equivalentes, toque em "Equivalentes" num item do plano.',
  /** RNF-232: a ação do item ("Equivalentes de {item}"). */
  equivalentesDe: (item: string) => `Equivalentes de ${item}`,
  /** US-234: "Arroz branco, cozido — 120 g (154 kcal)". */
  referencia: (nome: string, gramas: string, kcal: string | null) => `${nome} — ${gramas} g${kcal === null ? '' : ` (${kcal} kcal)`}`,
  /** US-234: "Macarrão, cozido — 104 g". */
  sugerido: (nome: string, gramas: string) => `${nome} — ${gramas} g`,
} as const;
