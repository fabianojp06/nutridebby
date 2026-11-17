'use client';

import { useEffect } from 'react';

/**
 * Plano 18 (US-263): ao chegar por um link com âncora (ex.: "Adicionar" → `antropometria#nova-avaliacao`), põe o foco no
 * elemento apontado — o título da seção (com `tabIndex={-1}`) ou o campo (`#modelo` da Anamnese) —, para o leitor de tela
 * e o teclado começarem ali, não no topo da página. Sem âncora, ou com âncora que não existe na tela, não faz nada.
 */
export function FocoNaAncora() {
  useEffect(() => {
    const focar = () => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return; // âncora malformada (ex.: "#%"): nada a focar
      }
      if (id) document.getElementById(id)?.focus();
    };
    focar();
    window.addEventListener('hashchange', focar);
    return () => window.removeEventListener('hashchange', focar);
  }, []);
  return null;
}
