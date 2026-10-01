'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Enquanto o PDF é gerado, consulta só o estado dele a cada 3 s, por até 60 s, numa rota leve e sem auditoria
 * (recarregar a página a cada 3 s gravava várias leituras "Visualizou" por ciclo). Quando o estado muda, recarrega
 * os dados da página uma vez: "o botão é liberado quando o arquivo fica pronto".
 */
export function AtualizarEnquanto({ planId, patientId }: { planId: string; patientId: string }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    let ativo = true; // falso depois de desmontar ou de pedir a recarga (consultas sobrepostas não recarregam duas vezes)
    const t = setInterval(async () => {
      if (++n >= 20) clearInterval(t);
      try {
        const r = await fetch(`/api/painel/planos/${planId}/pdf?paciente=${patientId}`, { cache: 'no-store' });
        if (!ativo || !r.ok) return;
        const { pdfStatus } = (await r.json()) as { pdfStatus: string | null };
        if (!ativo || pdfStatus === 'pendente') return;
        ativo = false;
        clearInterval(t);
        router.refresh();
      } catch {
        // sem rede: tenta de novo no próximo ciclo
      }
    }, 3000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [router, planId, patientId]);
  return null;
}
