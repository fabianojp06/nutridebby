'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect } from 'react';
import { deveRecarregarAoVoltar } from '../sw-regras';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

/**
 * Plano 25 (RN-473): o `reloadOnOnline` padrão do Serwist recarrega QUALQUER página do portal quando a rede volta — na
 * conversa, o rascunho escrito sem rede se perdia. Desligado no provider e refeito aqui, menos em /p/mensagens. E nunca numa
 * página que já está saindo (E2E "nunca o plano"): o `online` chegava à cópia do plano entre o `beforeunload` e a troca de
 * documento, e o reload dela atropelava a navegação para a conversa (deveRecarregarAoVoltar).
 */
function RecarregarAoVoltar() {
  useEffect(() => {
    let saindo = false;
    const aoSair = () => {
      saindo = true;
    };
    const aoMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) saindo = false; // de volta do bfcache: a página ficou
    };
    const aoVoltar = () => {
      if (deveRecarregarAoVoltar({ pathname: window.location.pathname, saindo, online: navigator.onLine })) window.location.reload();
    };
    window.addEventListener('beforeunload', aoSair);
    window.addEventListener('pagehide', aoSair);
    window.addEventListener('pageshow', aoMostrar);
    window.addEventListener('online', aoVoltar);
    return () => {
      window.removeEventListener('beforeunload', aoSair);
      window.removeEventListener('pagehide', aoSair);
      window.removeEventListener('pageshow', aoMostrar);
      window.removeEventListener('online', aoVoltar);
    };
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
