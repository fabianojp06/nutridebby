'use client';

import { useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { authClient } from '@/lib/auth-client';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO } from '@/lib/turnstile';

export function EsqueciSenhaForm({ siteKey }: { siteKey: string }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [widget, setWidget] = useState(0); // trocar a key recria o widget (token é de uso único)

  function recomecar(msg: string) {
    setErro(msg);
    setToken(null);
    setWidget((n) => n + 1);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!token) return setErro(MSG_TURNSTILE_INVALIDO);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/definir-senha',
      fetchOptions: { headers: { 'x-turnstile-token': token } },
    });
    if (error?.status === 503 || (error?.status ?? 0) >= 500) return recomecar(MSG_TURNSTILE_FORA);
    if (error?.status === 403) return recomecar(MSG_TURNSTILE_INVALIDO);
    if (error?.status === 429) return setErro('Muitas tentativas. Tente novamente em 15 minutos.');
    setEnviado(true); // mesma resposta para qualquer e-mail (US-002)
  }

  if (enviado) return <p role="status">Se o e-mail estiver cadastrado, você receberá um link</p>;
  return (
    <form onSubmit={enviar} className="space-y-3">
      <label htmlFor="email" className="block">E-mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
      <TurnstileWidget key={widget} siteKey={siteKey} onToken={setToken} onIndisponivel={() => setErro(MSG_TURNSTILE_FORA)} />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button disabled={!token} className="w-full rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">Enviar link</button>
    </form>
  );
}
