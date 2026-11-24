'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect } from 'react';
import { deveRecarregarAoVoltar, ehCopiaOffline, vigiarSaida } from '../sw-regras';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

/**
 * SUS-112: o `reloadOnOnline` padrão do Serwist recarregava QUALQUER página do portal quando a rede voltava, e o que o
 * paciente digitava (diário, questionário, envio de exame…) se perdia. Desligado no provider e refeito aqui por lista de
 * permissão: recarrega só a cópia offline de "Meu plano" (ehCopiaOffline, pela marca que só o HTML guardado leva), com a
 * rede de fato de volta e a página ficando (vigiarSaida: o `online` chega à cópia entre o `beforeunload` e a troca de
 * documento no Chrome sem rede, e o reload atropelava a navegação em curso).
 */
function RecarregarAoVoltar() {
  useEffect(() => {
    const saida = vigiarSaida(window);
    const aoVoltar = () => {
      if (deveRecarregarAoVoltar({ copia: ehCopiaOffline(document), saindo: saida.saindo(), online: navigator.onLine })) window.location.reload();
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
