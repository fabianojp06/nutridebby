'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { recarregarCopiaAoVoltar } from '../sw-regras';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

/**
 * SUS-112: o `reloadOnOnline` padrão do Serwist recarregava QUALQUER página do portal quando a rede voltava, e o que o
 * paciente digitava (diário, questionário, envio de exame…) se perdia. Desligado no provider e refeito aqui por lista de
 * permissão: só a cópia offline de "Meu plano" (pela marca que só o HTML guardado leva) ganha os ouvintes e recarrega, com
 * a rede de fato de volta (`online` ou o ping do selo recuperado) e a página ficando (recarregarCopiaAoVoltar). A página
 * viva não ganha nenhum ouvinte. Refeito a cada endereço: o documento pode deixar de ser a cópia numa navegação do roteador.
 */
function RecarregarAoVoltar() {
  const pathname = usePathname();
  useEffect(() => {
    const vigia = recarregarCopiaAoVoltar({ janela: window, documento: document, online: () => navigator.onLine, recarregar: () => window.location.reload() });
    return () => vigia?.parar();
  }, [pathname]);
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
