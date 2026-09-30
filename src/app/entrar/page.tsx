'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { safeReturnPath } from '@/lib/safe-return';

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState(params.get('expirada') ? 'Sua sessão expirou. Entre de novo.' : '');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const { data, error } = await authClient.signIn.email({ email, password });
    setEnviando(false);
    if (error) {
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'E-mail ou senha incorretos.');
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return; // onTwoFactorRedirect cuida
    router.push(safeReturnPath(params.get('volta')) ?? '/inicio');
  }

  return (
    <form onSubmit={entrar} className="space-y-3">
      <label htmlFor="email" className="block">E-mail</label>
      <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
      <label htmlFor="password" className="block">Senha</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border p-2" />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button disabled={enviando} className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Entrar</button>
      <a href="/esqueci-senha" className="block text-sm underline">Esqueci minha senha</a>
    </form>
  );
}

export default function EntrarPage() {
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <Suspense><Form /></Suspense>
    </main>
  );
}
