import { termosNaPergunta, temTermo } from './termos-sensiveis';
import { FRASE_DO_TIPO, FRASE_FINAL } from './textos';
import type { TipoResposta } from './constantes';

/** Um trecho relido do banco na sessão de paciente, com a formatação da tela do plano (job.ts monta). */
export type Trecho = { indice: string; fonte: string; texto: string };

/** O CHECK `ia_nutri_mensagens_texto_tamanho` (0115): a resposta da IA tem até 24.000 caracteres. */
export const MAX_RESPOSTA_IA = 24_000;
const RETICENCIAS = '…';

/** RN-176 / D25 = b: cada termo sensível da pergunta tem de estar, verbatim, em algum trecho citado. */
export const conferirTermos = (pergunta: string, trechos: readonly Trecho[]): boolean =>
  termosNaPergunta(pergunta).every((termo) => trechos.some((t) => temTermo(t.texto, termo)));

/**
 * RN-255 (D25): numa troca, as substituições do item na refeição (#S, mais específicas) vêm antes da lista de substituição
 * do plano (#L), qualquer que seja a ordem que o modelo devolver; o resto fica na ordem recebida (ordenação estável).
 */
const ordemDaFonte = (t: Trecho): number => (t.indice.startsWith('#L') ? 1 : 0);

/** RN-172: frase fixa do tipo + trechos (texto e fonte) + frase final. Nenhuma palavra do modelo. */
export function montarResposta(tipo: TipoResposta, trechos: readonly Trecho[]): string {
  const ordenados = trechos.toSorted((a, b) => ordemDaFonte(a) - ordemDaFonte(b));
  return [FRASE_DO_TIPO[tipo], ...ordenados.flatMap((t) => [t.texto, `Fonte: ${t.fonte}`]), FRASE_FINAL].join('\n');
}

/** Corta em `max` unidades de UTF-16 com "…" no fim, sem partir um par substituto (emoji). */
function cortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  if (max <= RETICENCIAS.length) return RETICENCIAS.slice(0, Math.max(max, 0));
  let fim = max - RETICENCIAS.length;
  const c = texto.charCodeAt(fim - 1);
  if (c >= 0xd800 && c <= 0xdbff) fim--;
  return `${texto.slice(0, fim)}${RETICENCIAS}`;
}

/**
 * R-239: os trechos cortados para `montarResposta` caber em MAX_RESPOSTA_IA (uma refeição de 400 itens ou quatro grupos de
 * lista cheios passariam do CHECK). As frases fixas e as fontes ficam inteiras; o espaço dos textos é dividido por igual,
 * e o que um trecho curto não usa sobra para os outros. Sem corte quando já cabe. O comprimento é o do JS (UTF-16), que
 * nunca é menor que o `char_length` do Postgres.
 */
export function cortarParaCaber(tipo: TipoResposta, trechos: readonly Trecho[]): Trecho[] {
  if (montarResposta(tipo, trechos).length <= MAX_RESPOSTA_IA) return [...trechos];
  const fixo = montarResposta(tipo, trechos.map((t) => ({ ...t, texto: '' }))).length;
  let livre = Math.max(MAX_RESPOSTA_IA - fixo, 0);
  const limites = new Map<number, number>();
  const pendentes = trechos.map((t, i) => ({ i, n: t.texto.length })).toSorted((a, b) => a.n - b.n);
  pendentes.forEach((p, k) => {
    const parte = Math.floor(livre / (pendentes.length - k));
    const limite = Math.min(p.n, parte);
    limites.set(p.i, limite);
    livre -= limite;
  });
  return trechos.map((t, i) => ({ ...t, texto: cortar(t.texto, limites.get(i)!) }));
}
