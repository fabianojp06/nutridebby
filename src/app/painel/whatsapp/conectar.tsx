'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { conectarAction, type ConectarState } from './actions';

/** QR + polling do estado a cada 3 s por até 3 min; conectado → recarrega a página. */
export function ConectarWhatsapp() {
  const [state, action, pendente] = useActionState<ConectarState>(conectarAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.conectada) return router.refresh();
    if (!state.qr) return;
    const fim = Date.now() + 3 * 60_000;
    const t = setInterval(async () => {
      if (Date.now() > fim) return clearInterval(t);
      const r = await fetch('/api/painel/whatsapp/estado', { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { estado: string }) : null;
      if (j?.estado === 'conectada') {
        clearInterval(t);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [state, router]);
  return (
    <div data-guia="conectar-whatsapp" className="space-y-3">
      <form action={action}>
        <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{state.qr ? 'Gerar novo QR code' : 'Conectar WhatsApp'}</button>
      </form>
      {state.erro && <p role="alert" className="text-erro">{state.erro}</p>}
      {state.qr && (
        <div className="space-y-2">
          <p>No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho e aponte para este código.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL gerado na hora, fora do otimizador */}
          <img src={state.qr} alt="QR code para conectar o WhatsApp" width={264} height={264} className="rounded border border-borda bg-white p-2" />
        </div>
      )}
    </div>
  );
}
