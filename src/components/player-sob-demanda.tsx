'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * D12: o iframe do YouTube/Vimeo só entra depois do clique — abrir o conteúdo não manda o IP do paciente ao provedor.
 * `src` já vem montado do id validado (urlDoPlayer, Plano 07 D10). O YouTube recusa embed sem referrer:
 * `strict-origin-when-cross-origin` manda só a origem (nunca o caminho do portal).
 * Foco: o botão sai do DOM no clique; o foco vai para o iframe (WCAG 2.4.3), não cai no <body>. Na moldura preta o
 * contorno do foco é branco (`--nd-foco`): a cor da marca sobre o preto fica abaixo de 3:1 com marca escura.
 */
export function PlayerSobDemanda({ src, titulo, provedor }: { src: string; titulo: string; provedor: 'YouTube' | 'Vimeo' }) {
  const [carregar, setCarregar] = useState(false);
  const quadro = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (carregar) quadro.current?.focus();
  }, [carregar]);
  if (carregar) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded bg-black [--nd-foco:#ffffff]">
        <iframe
          ref={quadro}
          src={src}
          title={`Vídeo: ${titulo}`}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0 focus-visible:outline-offset-[-3px]"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded bg-black p-4 text-center text-white [--nd-foco:#ffffff]">
      <button type="button" onClick={() => setCarregar(true)} className="min-h-11 rounded-full bg-white px-5 font-semibold text-black">
        Carregar o vídeo
      </button>
      <p className="text-sm">{`O vídeo é exibido pelo ${provedor}.`}</p>
    </div>
  );
}
