'use client';
import { useEffect, useState } from 'react';

/** US-040 "Offline": "Offline — exibindo última versão" quando a página veio do cache do service worker. */
export function SeloOffline() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      if (!navigator.onLine) return vivo && setOffline(true);
      try {
        const r = await fetch('/api/p/ping', { cache: 'no-store' });
        if (vivo) setOffline(!r.ok);
      } catch {
        if (vivo) setOffline(true);
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
  return offline ? <p role="status" className="bg-amber-100 px-6 py-2 text-amber-900">Offline — exibindo última versão</p> : null;
}
