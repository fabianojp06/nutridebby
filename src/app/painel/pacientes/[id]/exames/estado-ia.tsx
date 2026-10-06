'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { POLL_IA_MS } from '@/modules/ia/constantes';

/**
 * RNF-100: enquanto a leitura está na fila ou em andamento, consulta só a situação (GET sem auditoria) a cada 3 s, por até
 * 3 min; quando muda, recarrega a página uma vez.
 */
export function EstadoIa({ tarefaId }: { tarefaId: string }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    let ativo = true;
    const t = setInterval(async () => {
      if (++n >= 60) clearInterval(t);
      try {
        const r = await fetch(`/api/painel/ia/tarefas/${tarefaId}`, { cache: 'no-store' });
        if (!ativo || !r.ok) return;
        const { status } = (await r.json()) as { status: string };
        if (!ativo || status === 'na_fila' || status === 'processando') return;
        ativo = false;
        clearInterval(t);
        router.refresh();
      } catch {
        // sem rede: tenta no próximo ciclo
      }
    }, POLL_IA_MS);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [router, tarefaId]);
  return null;
}
