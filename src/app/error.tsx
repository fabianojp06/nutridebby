'use client';

import { useEffect } from 'react';
import { reportarErro } from '@/components/reportar-erro';

export default function Erro({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportarErro(error), [error]);
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Algo deu errado.</h1>
      <button type="button" onClick={() => retry()} className="min-h-11 rounded border px-4">
        Tentar de novo
      </button>
    </main>
  );
}
