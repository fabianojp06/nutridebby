import { CATEGORIAS_CONVERSA, TIPOS_RESPOSTA, type CategoriaConversa, type MotivoTecnico, type TipoResposta } from './constantes';
import { perguntaComCondicao } from './termos-sensiveis';
import { TEXTO_DA_CATEGORIA, type CodigoTextoFixo } from './textos';

/** RN-175: os prefixos de índice aceitos em cada tipo de resposta. */
const PREFIXOS: Record<TipoResposta, readonly string[]> = {
  quantidade: ['#I', '#S'], substituicao: ['#S'], horario: ['#R'], refeicao: ['#R'], orientacao: ['#O', '#A'],
};
export type SaidaValidada =
  | { ok: true; tipo: TipoResposta; fontes: string[] }
  | { ok: false; categoria: CategoriaConversa | null; textoFixo: CodigoTextoFixo; motivo: MotivoTecnico | null; risco: boolean };
const naoEncontrei = (motivo: MotivoTecnico): SaidaValidada => ({ ok: false, categoria: null, textoFixo: 'nao_encontrei', motivo, risco: false });

/**
 * Plano 15 (RN-175, D21 = a): o JSON do schema fixo, SEM campo de texto livre (campo a mais → inválido); categoria e tipo das
 * listas fechadas; em `plano`, 1 a 4 fontes enviadas e coerentes com o tipo; pergunta "posso X se tenho Y" nunca vira
 * resposta montada. O que passa ainda é conferido na releitura (job.ts) e nos termos (montar-resposta.ts).
 */
export function validarSaida(texto: string, o: { enviados: ReadonlySet<string>; pergunta: string }): SaidaValidada {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return naoEncontrei('invalida_formato');
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return naoEncontrei('invalida_formato');
  const r = j as Record<string, unknown>;
  const chaves = Object.keys(r).sort().join(',');
  if (chaves !== 'categoria,fontes,tipo_resposta') return naoEncontrei('invalida_formato');
  if (typeof r.categoria !== 'string' || !(CATEGORIAS_CONVERSA as readonly string[]).includes(r.categoria)) return naoEncontrei('invalida_formato');
  const categoria = r.categoria as CategoriaConversa;
  if (categoria !== 'plano') return { ok: false, categoria, textoFixo: TEXTO_DA_CATEGORIA[categoria], motivo: null, risco: categoria === 'risco' };
  if (perguntaComCondicao(o.pergunta)) return { ok: false, categoria: 'sintoma_ou_exame', textoFixo: 'sintoma_ou_exame', motivo: 'condicao', risco: false };
  if (typeof r.tipo_resposta !== 'string' || !(TIPOS_RESPOSTA as readonly string[]).includes(r.tipo_resposta)) return naoEncontrei('invalida_tipo');
  const tipo = r.tipo_resposta as TipoResposta;
  const fontes = r.fontes;
  if (!Array.isArray(fontes) || fontes.length < 1 || fontes.length > 4 || !fontes.every((f) => typeof f === 'string' && o.enviados.has(f))) return naoEncontrei('invalida_fonte');
  if (!fontes.every((f: string) => PREFIXOS[tipo].some((p) => f.startsWith(p)))) return naoEncontrei('invalida_tipo');
  return { ok: true, tipo, fontes: [...new Set(fontes as string[])] };
}
