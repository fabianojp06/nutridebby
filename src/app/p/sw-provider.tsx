'use client';
import { SerwistProvider } from '@serwist/turbopack/react';
import './instalacao-prompt'; // US-040: ouve o beforeinstallprompt desde a carga do portal, antes de o Início montar

export function SwProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider swUrl="/serwist/sw.js" options={{ scope: '/p/' }}>
      {children}
    </SerwistProvider>
  );
}
