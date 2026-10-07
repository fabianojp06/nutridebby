'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { acompanharLeitura } from './acompanhar-leitura';

/** RNF-100: acompanha a leitura (acompanhar-leitura.ts) e, quando a situação muda, recarrega a página uma vez. */
export function EstadoIa({ tarefaId }: { tarefaId: string }) {
  const router = useRouter();
  useEffect(() => acompanharLeitura(tarefaId, () => router.refresh()), [router, tarefaId]);
  return null;
}
