'use client';

import type { ReactNode } from 'react';

/** Botão de envio que pede confirmação antes (ações que derrubam acesso ou apagam registro). */
export function ConfirmarBotao({ mensagem, children, rotulo }: { mensagem: string; children: ReactNode; rotulo?: string }) {
  return (
    <button className="underline" aria-label={rotulo} onClick={(e) => { if (!window.confirm(mensagem)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
