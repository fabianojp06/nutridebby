'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { acompanharEstadoPdf } from './acompanhar-estado-pdf';

/**
 * "Preparando o PDF…" (T6) e "Montando o PDF digitalizado…" (T9): pergunta o estado a cada 3 s (sem auditoria, como o
 * plano alimentar, e sem contar como uso da sessão, P12-14) por até 1 h, e recarrega quando muda. `esperando` diz o que
 * olhar — sem ela, o documento em "Aguardando assinatura" recarregaria a página a cada 3 s (a condição do PDF olha só o
 * "preparando"). O texto vem da prop, não do módulo (componente 'use client').
 */
export function EstadoPdf({ docId, esperando = 'pdf' }: { docId: string; esperando?: 'pdf' | 'digitalizacao' }) {
  const router = useRouter();
  useEffect(() => acompanharEstadoPdf(docId, esperando, () => router.refresh()), [docId, esperando, router]);
  return <p role="status" aria-live="polite">{esperando === 'pdf' ? 'Preparando o PDF…' : 'Montando o PDF digitalizado…'}</p>;
}
