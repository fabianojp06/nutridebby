'use client';

import { useEffect } from 'react';
import { reportarErro } from '@/components/reportar-erro';

export default function ErroGlobal({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportarErro(error), [error]);
  return (
    <html lang="pt-BR">
      <body>
        <main style={{ maxWidth: 480, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1>Algo deu errado.</h1>
          <button type="button" onClick={() => retry()} style={{ minHeight: 44, padding: '0 16px' }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
