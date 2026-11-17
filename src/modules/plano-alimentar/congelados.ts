import { FONTES_DE_ALIMENTO, type Fonte } from '@/modules/alimentos/fontes';
import { ehChaveNutriente } from '@/modules/alimentos/nutrientes';
import type { MicrosPorCem } from './calculo';

/**
 * RN-237 (Plano 19): o item como foi congelado na publicação (`meal_items.nutrientes`), já no formato novo. `micros`
 * nulo = plano publicado antes do Plano 19 ("Micronutrientes não registrados nesta versão do plano.").
 */
export type Congelado = {
  nome: string;
  fonte: Fonte;
  /** Versão da tabela no momento da publicação; nula no "Meu alimento" e no formato antigo (não foi registrada). */
  fonteVersao: string | null;
  /** RN-233: fonte de origem do "Meu alimento" duplicado de uma tabela pública (rodapé do PDF). */
  fonteOrigem: Fonte | null;
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  lipidioG: number | null;
  fibraG: number | null;
  micros: MicrosPorCem | null;
};

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ehFonte = (v: unknown): v is Fonte => typeof v === 'string' && (FONTES_DE_ALIMENTO as readonly string[]).includes(v);
const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Formato antigo (sem `fonte`): a fonte sai de `origem`. Correto só porque nenhuma linha da USDA existe enquanto a
 * imagem antiga pode publicar (D29: o seed da USDA vai num PR seguinte ao deploy do código que conhece `foods.fonte`);
 * antes disso, `'TACO'` era sempre a TACO.
 */
const fonteDaOrigem = (origem: unknown): Fonte | undefined => (origem === 'TACO' ? 'taco' : origem === 'Meu alimento' ? 'propria' : undefined);

function lerMicros(m: unknown): MicrosPorCem | null {
  if (!objeto(m)) return null;
  const out: MicrosPorCem = {};
  for (const [k, v] of Object.entries(m)) {
    if (!ehChaveNutriente(k)) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * RN-237: o único leitor de `meal_items.nutrientes` (PDF, portal, exportação, resumo da IA, contexto da IA Nutri e
 * editor). Aceita o formato antigo (planos publicados antes do Plano 19) e o novo; chave de micro fora do catálogo e
 * valor que não é número saem. O chamador trata o item sem congelado (rascunho, `nutrientes` nulo) antes de chamar.
 */
export function lerCongelados(n: unknown): Congelado {
  // a mensagem nunca leva o conteúdo (nome de alimento e valores são do plano do paciente — CLAUDE.md, regra 3)
  if (!objeto(n)) throw new TypeError('lerCongelados: nutrientes congelados ausentes ou fora do formato');
  const fonte = ehFonte(n.fonte) ? n.fonte : fonteDaOrigem(n.origem);
  if (!fonte) throw new TypeError('lerCongelados: item congelado sem fonte nem origem conhecida');
  return {
    nome: typeof n.nome === 'string' ? n.nome : '',
    fonte,
    fonteVersao: typeof n.fonteVersao === 'string' ? n.fonteVersao : null,
    fonteOrigem: ehFonte(n.fonteOrigem) ? n.fonteOrigem : null,
    kcal: numeroOuNulo(n.kcal),
    proteinaG: numeroOuNulo(n.proteinaG),
    carboidratoG: numeroOuNulo(n.carboidratoG),
    lipidioG: numeroOuNulo(n.lipidioG),
    fibraG: numeroOuNulo(n.fibraG),
    micros: lerMicros(n.micros),
  };
}
