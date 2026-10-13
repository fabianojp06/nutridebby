'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { acompanharLeitura } from '@/app/painel/pacientes/[id]/exames/acompanhar-leitura';

/**
 * RNF-100: acompanha a situação de uma tarefa da IA pela `url` da rota de situação (leitura do laudo ou pacote de
 * modelos) e, quando ela muda, recarrega a página uma vez. Sem conteúdo e sem auditoria (só status).
 */
export function EstadoTarefa({ url }: { url: string }) {
  const router = useRouter();
  useEffect(() => acompanharLeitura(url, () => router.refresh()), [router, url]);
  return null;
}
