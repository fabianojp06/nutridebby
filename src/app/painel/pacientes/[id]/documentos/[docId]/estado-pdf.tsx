'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** "Preparando o PDF…": pergunta o estado a cada 3 s (sem auditoria, como o plano alimentar) e recarrega quando muda. */
export function EstadoPdf({ docId }: { docId: string }) {
  const router = useRouter();
  useEffect(() => {
    let vivo = true;
    const t = setInterval(async () => {
      const r = await fetch(`/api/painel/documentos/${docId}/pdf?estado=1`, { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { status: string; pdfStatus: string | null }) : null;
      if (vivo && j && (j.status !== 'preparando' || j.pdfStatus === 'falhou' || j.pdfStatus === 'sem_cota')) router.refresh();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [docId, router]);
  return <p role="status" aria-live="polite">Preparando o PDF…</p>;
}
