'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { validatePasswordPolicy } from '@/lib/password-policy';

function Form() {
  const params = useSearchParams();
  const token = params.get('token');
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState(params.get('error') ? 'Link inválido ou expirado. Peça um novo.' : '');
  const [ok, setOk] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const local = validatePasswordPolicy(senha);
    if (local) return setErro(local);
    if (senha !== confirma) return setErro('As senhas não conferem.');
    const { error } = await authClient.resetPassword({ newPassword: senha, token: token ?? '' });
    if (error) {
      if (error.code === 'INVALID_TOKEN') return setErro('Link inválido ou expirado. Peça um novo.');
      if (error.status === 400 && !error.code) return setErro(error.message ?? 'Não foi possível definir a senha. Tente novamente.');
      return setErro('Não foi possível definir a senha. Tente novamente.');
    }
    setOk(true);
  }

  if (ok) return <p role="status">Senha definida. <a href="/entrar" className="underline">Entrar</a></p>;
  if (!token) return <p role="alert">Link inválido ou expirado. Peça um novo.</p>;
  return (
    <form onSubmit={salvar} className="space-y-3">
      <p className="text-sm">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
      <label htmlFor="senha" className="block">Nova senha</label>
      <input id="senha" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full rounded border p-2" />
      <label htmlFor="confirma" className="block">Repita a senha</label>
      <input id="confirma" type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} className="w-full rounded border p-2" />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Definir senha</button>
    </form>
  );
}

export default function DefinirSenhaPage() {
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Definir senha</h1>
      <Suspense><Form /></Suspense>
    </main>
  );
}
