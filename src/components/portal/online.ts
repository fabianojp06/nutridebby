'use client';
import { useSyncExternalStore } from 'react';

const assinar = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** RN-208: sem rede, os botões que gravam ficam desabilitados. No servidor e na hidratação, "online" (o HTML não mente sobre o aparelho). */
export function useOnline(): boolean {
  return useSyncExternalStore(assinar, () => navigator.onLine, () => true);
}
