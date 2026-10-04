'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

/**
 * O `<details>` do menu da conta. O layout fica montado na navegação do App Router e o `open` é estado do DOM, então,
 * com JavaScript, fecha ao escolher um link (inclusive o do tour, que fica na mesma página), quando a rota muda (voltar
 * do navegador), com Esc (o foco volta ao avatar) e com clique fora. Sem JavaScript, é o `<details>` de sempre.
 */
export function DetalhesDaConta({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const caminho = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [caminho]);

  useEffect(() => {
    const foraDele = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener('pointerdown', foraDele);
    return () => document.removeEventListener('pointerdown', foraDele);
  }, []);

  const aoClicar = (e: MouseEvent<HTMLDetailsElement>) => {
    // só links: o "Sair" é um <form> que posta, e esconder o botão no meio do clique não ajuda ninguém
    if (e.target instanceof Element && e.target.closest('a') && ref.current) ref.current.open = false;
  };
  const aoTeclar = (e: KeyboardEvent<HTMLDetailsElement>) => {
    const d = ref.current;
    if (e.key !== 'Escape' || !d?.open) return;
    d.open = false;
    d.querySelector('summary')?.focus();
  };

  return (
    <details ref={ref} className="relative" data-guia="conta" onClick={aoClicar} onKeyDown={aoTeclar}>
      {children}
    </details>
  );
}
