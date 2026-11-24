'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect } from 'react';
import { deveRecarregarAoVoltar, vigiarSaida } from '../sw-regras';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

/**
 * Plano 25 (RN-473): o `reloadOnOnline` padrão do Serwist recarrega QUALQUER página do portal quando a rede volta — na
 * conversa, o rascunho escrito sem rede se perdia. Desligado no provider e refeito aqui, menos em /p/mensagens. E nunca numa
 * página que já está saindo (E2E "nunca o plano"): o `online` chegava à cópia do plano entre o `beforeunload` e a troca de
 * documento, e o reload dela atropelava a navegação para a conversa (deveRecarregarAoVoltar). /code-review do PR 2 (nit 6):
 * o "saindo" do `beforeunload` vence sozinho se a página não descarrega (download, `tel:`, `mailto:`) — vigiarSaida.
 */
function RecarregarAoVoltar() {
  useEffect(() => {
    const saida = vigiarSaida(window);
    const aoVoltar = () => {
      if (deveRecarregarAoVoltar({ pathname: window.location.pathname, saindo: saida.saindo(), online: navigator.onLine })) window.location.reload();
    };
    window.addEventListener('online', aoVoltar);
    return () => {
      saida.parar();
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
