'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { Guia } from '@/modules/ajuda/conteudo';

/** D26: o texto da tela atual, numa gaveta modal à direita (<dialog>). */
export function GavetaAjuda({ guia, aberta, aoFechar, verTour }: { guia: Guia | null; aberta: boolean; aoFechar: () => void; verTour: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="ajuda-titulo"
      onClose={aoFechar}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(28rem,100vw)] border-l border-borda bg-cartao p-6 text-texto"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="ajuda-titulo" className="font-titulo text-xl font-semibold">{guia ? `Ajuda: ${guia.titulo}` : 'Ajuda'}</h2>
        <button type="button" onClick={aoFechar} className="inline-flex min-h-11 items-center px-2 text-link underline">Fechar</button>
      </div>
      {guia && (
        <div className="mt-4 space-y-4">
          <p>{guia.ajuda.resumo}</p>
          {guia.ajuda.secoes.map((s) => (
            <section key={s.titulo} className="space-y-1">
              <h3 className="font-semibold">{s.titulo}</h3>
              <ul className="list-disc space-y-1 pl-5">{s.itens.map((it) => <li key={it}>{it}</li>)}</ul>
            </section>
          ))}
          <button
            type="button"
            onClick={() => {
              ref.current?.close(); // fecha antes de o tour abrir: a volta do foco da gaveta não briga com o foco do tour
              verTour();
            }}
            className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white"
          >
            Ver o tour desta tela
          </button>
        </div>
      )}
      <p className="mt-6">
        <Link href={guia ? `/painel/ajuda#${guia.id}` : '/painel/ajuda'} onClick={aoFechar} className="text-link underline">Abrir o manual completo</Link>
      </p>
    </dialog>
  );
}
