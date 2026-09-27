'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { authClient } from '@/lib/auth-client';

export function Enable2fa() {
  const [step, setStep] = useState<'senha' | 'codigo' | 'codigos'>('senha');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [backup, setBackup] = useState<string[]>([]);
  const [erro, setErro] = useState('');

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || data.method !== 'totp') return setErro('Senha incorreta.');
    setSecret(new URL(data.totpURI).searchParams.get('secret') ?? '');
    setQr(await QRCode.toDataURL(data.totpURI));
    setBackup(data.backupCodes);
    setStep('codigo');
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return setErro('Código inválido. Confira o horário do celular e tente de novo.');
    setStep('codigos');
  }

  if (step === 'senha')
    return (
      <form onSubmit={iniciar} className="space-y-3">
        <label htmlFor="senha" className="block">Confirme sua senha</label>
        <input id="senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="rounded bg-emerald-700 px-4 py-2 text-white">Ativar verificação em duas etapas</button>
      </form>
    );

  if (step === 'codigo')
    return (
      <form onSubmit={confirmar} className="space-y-3">
        <p>Leia o QR Code no app autenticador (Google Authenticator, Authy, 1Password…).</p>
        {qr && <img src={qr} alt="QR Code para o app autenticador" width={200} height={200} />}
        <p className="text-sm">Ou digite a chave: <code data-testid="totp-secret">{secret}</code></p>
        <label htmlFor="codigo" className="block">Código de 6 dígitos</label>
        <input id="codigo" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar</button>
      </form>
    );

  return (
    <div className="space-y-3">
      <p role="status">Verificação em duas etapas ativada.</p>
      <p>Guarde estes códigos de recuperação. Cada um funciona uma vez, e eles não serão mostrados de novo.</p>
      <ul data-testid="backup-codes" className="grid grid-cols-2 gap-1 font-mono">
        {backup.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <a href="/inicio" className="inline-block rounded bg-emerald-700 px-4 py-2 text-white">Continuar</a>
    </div>
  );
}
