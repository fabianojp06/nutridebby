'use client';

import { useState } from 'react';

/**
 * D12: o iframe do YouTube/Vimeo só entra depois do clique — abrir o conteúdo não manda o IP do paciente ao provedor.
 * `src` já vem montado do id validado (urlDoPlayer, Plano 07 D10). O YouTube recusa embed sem referrer:
 * `strict-origin-when-cross-origin` manda só a origem (nunca o caminho do portal).
 */
export function PlayerSobDemanda({ src, titulo, provedor }: { src: string; titulo: string; provedor: 'YouTube' | 'Vimeo' }) {
  const [carregar, setCarregar] = useState(false);
  if (carregar) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
        <iframe
          src={src}
          title={`Vídeo: ${titulo}`}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded bg-black p-4 text-center text-white">
      <button type="button" onClick={() => setCarregar(true)} className="min-h-11 rounded-full bg-white px-5 font-semibold text-black">
        Carregar o vídeo
      </button>
      <p className="text-sm">{`O vídeo é exibido pelo ${provedor}.`}</p>
    </div>
  );
}
