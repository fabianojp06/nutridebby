import { termosNaPergunta, temTermo } from './termos-sensiveis';
import { FRASE_DO_TIPO, FRASE_FINAL } from './textos';
import type { TipoResposta } from './constantes';

/** Um trecho relido do banco na sessão de paciente, com a formatação da tela do plano (job.ts monta). */
export type Trecho = { indice: string; fonte: string; texto: string };

/** RN-176 / D25 = b: cada termo sensível da pergunta tem de estar, verbatim, em algum trecho citado. */
export const conferirTermos = (pergunta: string, trechos: readonly Trecho[]): boolean =>
  termosNaPergunta(pergunta).every((termo) => trechos.some((t) => temTermo(t.texto, termo)));

/** RN-172: frase fixa do tipo + trechos (texto e fonte) + frase final. Nenhuma palavra do modelo. */
export function montarResposta(tipo: TipoResposta, trechos: readonly Trecho[]): string {
  return [FRASE_DO_TIPO[tipo], ...trechos.flatMap((t) => [t.texto, `Fonte: ${t.fonte}`]), FRASE_FINAL].join('\n');
}
