'use client';
import { useEffect, useState } from 'react';

/** Sem resposta do ping em 5 s ("lie-fi": a rede existe mas não responde — o NetworkFirst já serviu a cópia aos 4 s) = offline. */
const PRAZO_PING_MS = 5000;

/**
 * US-040 "Offline": "Offline — exibindo última versão" quando a página veio do cache do service worker. A região viva
 * (role="status") fica sempre montada e só o texto muda: inserida já com o texto, o leitor de tela costuma não anunciar.
 */
export function SeloOffline() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      if (!navigator.onLine) return vivo && setOffline(true);
      try {
        const r = await fetch('/api/p/ping', { cache: 'no-store', signal: AbortSignal.timeout(PRAZO_PING_MS) });
        if (vivo) setOffline(!r.ok);
      } catch {
        if (vivo) setOffline(true); // sem rede ou prazo estourado (TimeoutError)
      }
    };
    void conferir();
    window.addEventListener('online', conferir);
    window.addEventListener('offline', conferir);
    return () => {
      vivo = false;
      window.removeEventListener('online', conferir);
      window.removeEventListener('offline', conferir);
    };
  }, []);
  return (
    <p role="status" className={offline ? 'bg-aviso-fundo px-6 py-2 text-aviso' : 'sr-only'}>
      {offline ? 'Offline — exibindo última versão' : ''}
    </p>
  );
}
