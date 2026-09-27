'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    await authClient.requestPasswordReset({ email, redirectTo: '/definir-senha' });
    setEnviado(true); // mesma resposta para qualquer e-mail (US-002)
  }

  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      {enviado ? (
        <p role="status">Se o e-mail estiver cadastrado, você receberá um link</p>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <label htmlFor="email" className="block">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
          <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Enviar link</button>
        </form>
      )}
    </main>
  );
}
