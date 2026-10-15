import type { GrupoRisco } from './constantes';

/**
 * Plano 15 (RN-174, §7.4 item 1): o filtro determinístico ANTES de gravar e de chamar o provedor — se achar, o modelo não é
 * chamado e nada sai do país. Lista inicial a revisar pela Debby (e, se possível, pelo psicólogo — D11); falso positivo é
 * aceito. Sobre o texto sem acento e em minúsculas. Nada do texto vai a log. Ordem: autolesão → sintoma agudo → transtorno.
 */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

// Revisão da T6 (rodada 1): entram os exemplos que a própria spec dá (§7.4 item 1: autolesão, vômito com sangue, reação
// alérgica grave, vomitar de propósito, ficar dias sem comer) e as formas comuns do mesmo grupo ("vontade de morrer",
// "se matar", "dores no peito", "sem ar", "um dia sem comer"). Falso positivo continua aceito (ex.: "vou morrer de fome").
// Rodada 2: "tirar a própria vida" (sem "minha"), "a vida não tem sentido", "estar morta", "vontade de sumir/desaparecer",
// "meu peito dói"/"peito apertado", "dificuldade para respirar" e "crise alérgica" (aceito: "morta de cansaço").
const AUTOLESAO = [
  /\b(me|se) matar\b/, /\bsuicid/, /\btirar (a )?(minha )?(propria )?vida\b/, /\bacabar com (a )?minha vida\b/,
  /\b(quero|queria|vou|vontade de|desejo de|penso em|pensando em) morrer\b/, /\bme machuc/, /\bme cort/, /\bautoles/,
  /\bautomutil/, /\bnao aguento mais\b/, /\b(quero|queria|vontade de) (sumir|desaparecer)\b/, /\bacabar com tudo\b/,
  /\bnao quero (mais )?viver\b/, /\bvida nao (tem|faz) (mais )?sentido\b/, /\b(estar|ficar) mort[oa]\b/,
];
const SINTOMA_AGUDO = [
  /\bdor(es)?( \w+){0,2} no (meu )?peito\b/, /\baperto no peito\b/, /\bfalta de ar\b/, /\bsem ar\b/, /\bpeito (\w+ )?(doi|doendo|apertad)/,
  /\b(dificuldade|custando|custa|nao consigo) (pra |para |de |em |a )?respirar\b/,
  /\bdesmai/, /\bvomit\w*.{0,15}sangue\b/, /\bsangue no vomito\b/, /\bgarganta (\w+ )?fechando\b/,
  /\b(labios?|lingua|rosto) inchad/, /\banafila/, /\breac(ao|oes) alergica/, /\bcrise alergica\b/,
];
const TRANSTORNO = [
  /\bvomit\w* (pra|para) (nao engordar|emagrecer|compensar)\b/, /\bvomit\w* de proposito\b/, /\b(induz|provoc)\w* (o )?vomito\b/,
  /\bdedo na garganta\b/, /\blaxante/, /\bdiuretico\w* (pra|para) (emagrecer|secar)\b/,
  /\b(um|\d+|dois|tres|varios) dias? sem comer\b/, /\b(fico|ficar|fiquei|passo|passei) (\w+ )?dias sem comer\b/,
  /\b(fico|fiquei|passo|passei) (o dia( todo)?|os dias) sem comer\b/,
  /\bcompulsa/, /\bcomo escondid/, /\bodeio (o )?meu corpo\b/, /\bnojo de mim\b/, /\bme sinto (muito )?gord\w* demais\b/,
];

export function detectarRisco(texto: string): { risco: GrupoRisco; textoFixo: 'risco_emergencia' | 'sintoma_agudo' | 'risco_transtorno' } | null {
  const t = normalizar(texto);
  if (AUTOLESAO.some((r) => r.test(t))) return { risco: 'emergencia', textoFixo: 'risco_emergencia' };
  if (SINTOMA_AGUDO.some((r) => r.test(t))) return { risco: 'emergencia', textoFixo: 'sintoma_agudo' };
  if (TRANSTORNO.some((r) => r.test(t))) return { risco: 'transtorno_alimentar', textoFixo: 'risco_transtorno' };
  return null;
}
