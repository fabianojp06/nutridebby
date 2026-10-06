'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { safeReturnPath } from '@/lib/safe-return';

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [erro, setErro] = useState('');

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { error } = usarRecuperacao
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (error) {
      if (error.code === 'CONTA_SUSPENSA') {
        // sem sessão aberta (o login falhou) — navegação client-side basta, nada a recarregar
        router.push('/indisponivel');
        return;
      }
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'Código inválido.');
    }
    // pós-2FA exige navegação completa para recarregar a sessão
    window.location.href = safeReturnPath(params.get('volta')) ?? '/inicio';
  }

  return (
    <>
      <form method="post" onSubmit={verificar} className="space-y-3">
        <label htmlFor="code" className="block">{usarRecuperacao ? 'Código de recuperação' : 'Código do app autenticador'}</label>
        <input id="code" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Verificar</button>
      </form>
      <button type="button" onClick={() => setUsarRecuperacao(!usarRecuperacao)} className="text-sm underline">
        {usarRecuperacao ? 'Usar o app autenticador' : 'Usar um código de recuperação'}
      </button>
    </>
  );
}

export default function DoisFatoresPage() {
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Verificação em duas etapas</h1>
      <Suspense><Form /></Suspense>
    </main>
  );
}
