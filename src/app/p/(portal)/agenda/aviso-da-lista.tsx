'use client';
import { useEffect, useRef } from 'react';

/**
 * Plano 23 (US-408): a região `role="status"` fixa de "Minhas consultas" — montada sempre (o texto que chega é anunciado) e,
 * com texto (a volta da desistência, `?ok=pedido-cancelado`), recebe o foco (`tabIndex={-1}`): a pessoa sai da tela do
 * pedido e cai aqui, sem perder o lugar. Vazia, fica `sr-only` (montada para anunciar, sem somar altura no topo; revisão
 * final do PR 3, M-3).
 */
export function AvisoDaLista({ texto }: { texto: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (texto) ref.current?.focus();
  }, [texto]);
  return (
    <p ref={ref} role="status" tabIndex={-1} className={texto ? 'rounded bg-ok-fundo p-3' : 'sr-only'}>
      {texto}
    </p>
  );
}
