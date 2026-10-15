import type { GrupoRisco } from './constantes';

/**
 * Plano 15 (RN-174, §7.4 item 1): o filtro determinístico ANTES de gravar e de chamar o provedor — se achar, o modelo não é
 * chamado e nada sai do país. Lista inicial a revisar pela Debby (e, se possível, pelo psicólogo — D11); falso positivo é
 * aceito. Sobre o texto sem acento e em minúsculas. Nada do texto vai a log. Ordem: autolesão → sintoma agudo → transtorno.
 */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

const AUTOLESAO = [
  /\bme matar\b/, /\bsuicid/, /\btirar (a )?minha (propria )?vida\b/, /\bquero morrer\b/, /\bme machuc/, /\bme cortar\b/,
  /\bnao aguento mais\b/, /\bquero sumir\b/, /\bacabar com tudo\b/, /\bnao quero (mais )?viver\b/,
];
const SINTOMA_AGUDO = [
  /\bdor no peito\b/, /\baperto no peito\b/, /\bfalta de ar\b/, /\bnao consigo respirar\b/, /\bdesmai/, /\bvomit\w* sangue\b/,
  /\bsangue no vomito\b/, /\bgarganta fechando\b/, /\b(labios?|lingua|rosto) inchad/, /\banafila/,
];
const TRANSTORNO = [
  /\bvomit\w* (pra|para) (nao engordar|emagrecer|compensar)\b/, /\bprovoc\w* (o )?vomito\b/, /\bdedo na garganta\b/, /\blaxante/,
  /\bdiuretico\w* (pra|para) (emagrecer|secar)\b/, /\b(\d+|dois|tres|varios) dias sem comer\b/, /\bpasso (o dia|os dias|o dia todo) sem comer\b/,
  /\bcompulsa/, /\bcomo escondid/, /\bodeio (o )?meu corpo\b/, /\bnojo de mim\b/, /\bme sinto (muito )?gord\w* demais\b/,
];

export function detectarRisco(texto: string): { risco: GrupoRisco; textoFixo: 'risco_emergencia' | 'sintoma_agudo' | 'risco_transtorno' } | null {
  const t = normalizar(texto);
  if (AUTOLESAO.some((r) => r.test(t))) return { risco: 'emergencia', textoFixo: 'risco_emergencia' };
  if (SINTOMA_AGUDO.some((r) => r.test(t))) return { risco: 'emergencia', textoFixo: 'sintoma_agudo' };
  if (TRANSTORNO.some((r) => r.test(t))) return { risco: 'transtorno_alimentar', textoFixo: 'risco_transtorno' };
  return null;
}
