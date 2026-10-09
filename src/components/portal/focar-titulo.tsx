'use client';
import { useEffect } from 'react';

/** RNF-191: ao abrir uma tela de detalhe, o foco vai para o título (o leitor de tela anuncia a tela nova). */
export function FocarTitulo() {
  useEffect(() => {
    document.getElementById('titulo-da-tela')?.focus({ preventScroll: true });
  }, []);
  return null;
}
