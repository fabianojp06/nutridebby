'use client';

import { useEffect, useState } from 'react';

/**
 * Plano 22 (T3, spec §7 "Mensagens e foco"): a região `<p role="status">` sempre montada, acima da lista. O texto entra um
 * instante depois de montar (o leitor de tela anuncia a mudança da região) e volta a entrar a cada `marcador` novo (a
 * mesma ação repetida). `focarTitulo`: depois de salvar ou excluir, o foco vai para o h1 (`tabIndex={-1}`) com esse id.
 */
export function RetornoDaTela({ texto, marcador, focarTitulo }: { texto: string; marcador: string; focarTitulo?: string }) {
  const [pronto, setPronto] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setPronto(marcador), 150);
    return () => window.clearTimeout(t);
  }, [marcador, texto]);
  useEffect(() => {
    if (texto && focarTitulo) document.getElementById(focarTitulo)?.focus();
  }, [marcador, texto, focarTitulo]);
  return <p role="status" className="min-h-6 font-medium">{texto && pronto === marcador ? texto : ''}</p>;
}
