'use client';

import { useEffect, useState } from 'react';
import { ID_DO_TITULO_LOCAIS } from './retornos';

/**
 * RNF-401 (WCAG 4.1.3), molde de `StatusDaLista` (src/app/painel/pacientes/menu-da-linha.tsx): a região `role="status"`
 * sempre montada (também vazia), fora da lista. O texto vem do servidor (`?ok=`) e só aparece um instante depois de cada
 * volta, marcada por `marcador` (`?r=`, um por ação): arquivar dois locais seguidos traz o mesmo texto, e sem esvaziar a
 * região antes o DOM não mudaria e o leitor de tela não anunciaria nada. Sem JavaScript, o texto já vem na página.
 */
export function StatusDosLocais({ texto, marcador }: { texto: string; marcador: string }) {
  const [pronto, setPronto] = useState<string | null>(marcador);
  useEffect(() => {
    const t = window.setTimeout(() => setPronto(marcador), 150);
    return () => window.clearTimeout(t);
  }, [marcador, texto]);
  return <p role="status" className="min-h-6 font-medium text-ok">{pronto === marcador ? texto : ''}</p>;
}

/**
 * Spec §12 (RNF-401): depois de uma ação da lista (a linha pode ter sumido, ou ido para os arquivados), o foco vai ao h1.
 * A página só monta este componente quando há `ok` ou `erro`, com `key` pelo marcador da ação.
 */
export function FocoNoTitulo() {
  useEffect(() => {
    document.getElementById(ID_DO_TITULO_LOCAIS)?.focus();
  }, []);
  return null;
}
