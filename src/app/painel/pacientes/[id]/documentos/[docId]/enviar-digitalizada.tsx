'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui/botao';

/**
 * RN-157 / D4: fotos das páginas + o código do 2FA (todo envio). Os textos vêm do servidor (MSG_DIGITALIZADA).
 * O botão sai do DOM no clique: o foco vai ao aviso da spec (WCAG 2.4.3, RNF-10), que o leitor de tela lê, não cai no <body>.
 */
export function EnviarDigitalizada({ docId, aviso, dica }: { docId: string; aviso: string; dica: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const avisoRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (aberto) avisoRef.current?.focus();
  }, [aberto]);
  if (!aberto) return <Botao type="button" variante="secundario" onClick={() => setAberto(true)}>Enviar documento digitalizado (assinado à mão)</Botao>;
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErro('');
        setEnviando(true);
        const r = await fetch(`/api/painel/documentos/${docId}/digitalizada`, { method: 'POST', body: new FormData(e.currentTarget) }).catch(() => null);
        const j = (r ? await r.json().catch(() => ({})) : {}) as { ok?: boolean; erro?: string };
        setEnviando(false);
        if (j.ok) router.refresh();
        else setErro(j.erro ?? 'Não foi possível enviar. Tente de novo.');
      }}
    >
      <p ref={avisoRef} tabIndex={-1} role="note" className="rounded-xl border border-borda p-3">{aviso}</p>
      <label htmlFor="fotos" className="block font-medium">Fotos das páginas (JPEG ou PNG, até 5)</label>
      <input id="fotos" name="fotos" type="file" accept="image/jpeg,image/png" multiple required aria-describedby="fotos-dica" />
      <p id="fotos-dica" className="text-sm text-suave">{dica}</p>
      <label htmlFor="codigo-2fa-dig" className="block font-medium">Código da verificação em duas etapas</label>
      <input id="codigo-2fa-dig" name="codigo2fa" inputMode="numeric" autoComplete="one-time-code" required className="w-40 rounded-xl border border-campo bg-cartao p-2 text-texto" />
      {erro && <p role="alert" className="text-erro">{erro}</p>}
      <Botao disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</Botao>
    </form>
  );
}
