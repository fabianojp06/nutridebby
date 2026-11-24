'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect } from 'react';
import { recarregaAoVoltarARede } from '../sw-regras';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

/**
 * Plano 25 (RN-473): o `reloadOnOnline` padrão do Serwist recarrega QUALQUER página do portal quando a rede volta — na
 * conversa, o rascunho escrito sem rede se perdia. Desligado no provider e refeito aqui, menos em /p/mensagens
 * (recarregaAoVoltarARede): a cópia do plano servida sem rede continua virando a página de verdade ao reconectar.
 */
function RecarregarAoVoltar() {
  useEffect(() => {
    const aoVoltar = () => {
      if (recarregaAoVoltarARede(window.location.pathname)) window.location.reload();
    };
    window.addEventListener('online', aoVoltar);
    return () => window.removeEventListener('online', aoVoltar);
  }, []);
  return null;
}

export function SwProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider swUrl="/serwist/sw.js" options={{ scope: '/p/' }} reloadOnOnline={false}>
      <RecarregarAoVoltar />
      {children}
    </SerwistProvider>
  );
}
