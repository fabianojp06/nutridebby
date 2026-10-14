'use client';

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * US-123 "Gerar" (revisão da T5): a confirmação "Gerando os modelos de {área}…" nasce preenchida (sem anúncio) no fim
 * de Configurações. Logo depois do pedido (`focar`, de `?modelos=pedido`), o foco vai para ela: a tela rola até a
 * confirmação e o leitor de tela a lê. Molde de `ConfirmarNoMural` (região role="status" com tabIndex -1).
 */
export function GerandoModelos({ focar, children }: { focar: boolean; children: ReactNode }) {
  const aviso = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focar) aviso.current?.focus();
  }, [focar]);
  return (
    <p ref={aviso} tabIndex={-1} role="status">
      {children}
    </p>
  );
}
