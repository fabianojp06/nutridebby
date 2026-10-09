'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** RN-195: o mural é do servidor; volta a ser buscado quando o app volta ao primeiro plano — sem anunciar nada ao leitor de tela. */
export function AtualizarAoVoltar() {
  const router = useRouter();
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [router]);
  return null;
}
