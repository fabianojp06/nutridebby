'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * "Preparando o PDF…" (T6) e "Montando o PDF digitalizado…" (T9): pergunta o estado a cada 3 s (sem auditoria, como o
 * plano alimentar) e recarrega quando muda. `esperando` diz o que olhar — sem ela, o documento em "Aguardando assinatura"
 * recarregaria a página a cada 3 s (a condição do PDF olha só o "preparando"). O texto vem da prop, não do módulo
 * (componente 'use client').
 */
export function EstadoPdf({ docId, esperando = 'pdf' }: { docId: string; esperando?: 'pdf' | 'digitalizacao' }) {
  const router = useRouter();
  useEffect(() => {
    let vivo = true;
    const t = setInterval(async () => {
      const r = await fetch(`/api/painel/documentos/${docId}/pdf?estado=1`, { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { status: string; pdfStatus: string | null; digitalizacaoStatus: string | null }) : null;
      const mudou = !j
        ? false
        : esperando === 'pdf'
          ? j.status !== 'preparando' || j.pdfStatus === 'falhou' || j.pdfStatus === 'sem_cota'
          : j.status !== 'aguardando_assinatura' || !['recebendo', 'pendente'].includes(j.digitalizacaoStatus ?? '');
      if (vivo && mudou) router.refresh();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [docId, esperando, router]);
  return <p role="status" aria-live="polite">{esperando === 'pdf' ? 'Preparando o PDF…' : 'Montando o PDF digitalizado…'}</p>;
}
