'use client';
import { SerwistProvider } from '@serwist/turbopack/react';

export function SwProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider swUrl="/serwist/sw.js" options={{ scope: '/p/' }}>
      {children}
    </SerwistProvider>
  );
}
