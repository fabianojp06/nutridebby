'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Campo } from '@/components/campo';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';

type Props = { token: string; siteKey: string | null; confirmarRecebimento?: boolean };
const FORA = 'Tente novamente em alguns minutos';

async function enviar(url: string, corpo: unknown): Promise<{ status: number; erro: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    const r = (await res.json().catch(() => ({}))) as { erro?: string };
    return { status: res.status, erro: r.erro ?? (res.ok ? '' : FORA) };
  } catch {
    return { status: 0, erro: FORA };
  }
}

/**
 * RN-158: sem sessão, Turnstile + "Enviar código" → o campo "Código" + "Abrir" (a página recarrega com a sessão);
 * com `confirmarRecebimento`, só o botão "Confirmo que recebi este documento".
 */
export function CodigoForm({ token, siteKey, confirmarRecebimento = false }: Props) {
  const router = useRouter();
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [erroCodigo, setErroCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const base = `/api/documento/${token}`;

  if (confirmarRecebimento) {
    const confirmar = async () => {
      setEnviando(true);
      const r = await enviar(`${base}/recebido`, {});
      setEnviando(false);
      if (r.status === 200) router.refresh();
      else setErro(r.erro);
    };
    return (
      <div className="space-y-2">
        <Botao type="button" onClick={confirmar} disabled={enviando}>
          Confirmo que recebi este documento
        </Botao>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
    );
  }

  async function pedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const r = await enviar(`${base}/codigo`, { turnstile });
    setEnviando(false);
    // o token do Turnstile é de uso único: um widget novo gera outro (para pedir de novo)
    setTurnstile(null);
    setWidget((n) => n + 1);
    setErro(r.status === 200 ? '' : r.erro);
    if (r.status === 200) setEnviado(true);
  }

  async function abrir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const r = await enviar(`${base}/confirmar`, { codigo: new FormData(e.currentTarget).get('codigo') });
    setEnviando(false);
    if (r.status === 200) {
      router.refresh();
      return;
    }
    setErroCodigo(r.erro);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={pedirCodigo} className="space-y-3">
        <p>Para abrir o documento, enviaremos um código de 6 dígitos para o seu e-mail.</p>
        {siteKey && <TurnstileWidget key={widget} siteKey={siteKey} onToken={setTurnstile} onIndisponivel={() => setErro(FORA)} />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {enviado && !erro && <Aviso tipo="ok">Código enviado. Confira seu e-mail.</Aviso>}
        <Botao type="submit" variante={enviado ? 'secundario' : 'primario'} disabled={enviando || !turnstile}>
          Enviar código
        </Botao>
      </form>
      {enviado && (
        <form onSubmit={abrir} className="max-w-sm space-y-3">
          <Campo id="codigo" rotulo="Código" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required erro={erroCodigo || undefined} />
          <Botao type="submit" disabled={enviando}>
            Abrir
          </Botao>
        </form>
      )}
    </div>
  );
}
