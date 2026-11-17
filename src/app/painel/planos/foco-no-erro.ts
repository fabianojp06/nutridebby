'use client';

import { useEffect, type RefObject } from 'react';

/** O campo inválido ou o aviso de erro sem campo ao lado (grupo sem alimentos, alimento recusado), marcado `data-foco-erro` e `tabIndex={-1}`. */
const ALVO = '[aria-invalid="true"], [data-foco-erro]';

/**
 * Formulário longo (lista de substituição: até 20 grupos × 30 itens; minha refeição: até 40 itens): o erro de um campo
 * sai ao lado dele, muitas vezes fora da tela de quem apertou o botão no fim da página. A cada resposta com erro de
 * campo, o foco (e a rolagem) vai ao primeiro campo inválido na ordem da página — o leitor de tela lê o rótulo e o erro
 * pelo `aria-describedby`. Só `geral` (que já sai junto do botão) não move o foco.
 */
export function useFocoNoPrimeiroErro(raiz: RefObject<HTMLElement | null>, erros: Record<string, string> | undefined) {
  useEffect(() => focarPrimeiroErro(raiz.current, erros), [raiz, erros]);
}

/** O corpo do efeito (exportado para o teste, que roda sem DOM). */
export function focarPrimeiroErro(raiz: Pick<ParentNode, 'querySelector'> | null, erros: Record<string, string> | undefined): void {
  if (!erros || !Object.keys(erros).some((k) => k !== 'geral')) return;
  const alvo = raiz?.querySelector<HTMLElement>(ALVO);
  if (!alvo) return;
  alvo.scrollIntoView({ block: 'center' });
  alvo.focus();
}
