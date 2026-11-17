'use client';

import { useEffect } from 'react';
import { focarTitulo } from './foco';

const ESTILO = { ok: 'rounded-2xl border border-ok bg-ok-fundo p-3 text-ok', aviso: 'rounded-2xl border border-aviso bg-aviso-fundo p-3 text-aviso' } as const;

/**
 * Spec §7: a região `role="status"` fica sempre montada acima da lista ou do formulário (a linha que muda pode sair da tela
 * com o `revalidatePath`, e uma região que nasce junto com o texto nem sempre é anunciada). Com `ok=` na URL, o foco vai
 * para o h1 da tela.
 */
export function Mensagens({ texto, tipo, focar }: { texto: string; tipo: keyof typeof ESTILO; focar: boolean }) {
  useEffect(() => {
    if (focar) focarTitulo();
  }, [focar, texto]);
  return (
    <p role="status" className={texto ? ESTILO[tipo] : undefined}>
      {texto}
    </p>
  );
}
