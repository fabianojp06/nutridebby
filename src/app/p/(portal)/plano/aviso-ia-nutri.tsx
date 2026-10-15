'use client';
import { useEffect, useRef } from 'react';

/**
 * Plano 15 (US-171, revisão final da 14A: nunca um redirect mudo): o aviso de volta do aceite recusado (`?ia-nutri=…`, lista
 * fechada lida em page.tsx). A região nasce já com o texto (página nova) e não seria anunciada: o foco vai para ela, como no
 * retorno do bloco de IA de Eu — o leitor de tela a lê e o navegador a traz para a vista.
 */
export function AvisoIaNutri({ texto }: { texto: string }) {
  const aviso = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    aviso.current?.focus();
  }, []);
  return (
    <p ref={aviso} tabIndex={-1} role="status" className="rounded-xl border border-borda bg-cartao p-3">
      {texto}
    </p>
  );
}
