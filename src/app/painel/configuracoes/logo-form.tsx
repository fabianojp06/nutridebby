'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LOGO_MAX_BYTES, MSG_LOGO_GRANDE } from '@/modules/plataforma/marca-constantes';

export function LogoForm() {
  const router = useRouter();
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro('');
    setOk(false);
    const arquivo = (e.currentTarget.elements.namedItem('logo') as HTMLInputElement).files?.[0];
    if (!arquivo) return setErro('Escolha um arquivo.');
    if (arquivo.size > LOGO_MAX_BYTES) return setErro(MSG_LOGO_GRANDE);
    setEnviando(true);
    const res = await fetch('/api/painel/marca/logo', { method: 'POST', body: arquivo });
    setEnviando(false);
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { erro?: string };
      return setErro(corpo.erro ?? 'Não foi possível enviar o logo.');
    }
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="space-y-2">
      <label htmlFor="logo" className="block font-medium">Logo</label>
      <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" aria-describedby="logo-dica" />
      <p id="logo-dica" className="text-sm text-suave">PNG, JPEG ou SVG de até 2 MB. O logo é reduzido para no máximo 512 px.</p>
      {erro && <p role="alert" className="text-erro">{erro}</p>}
      {ok && <p role="status">Logo atualizado.</p>}
      <button disabled={enviando} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Enviar logo</button>
    </form>
  );
}
