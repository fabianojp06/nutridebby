'use client';

import type { ReactNode } from 'react';

/** Botão de envio que pede confirmação antes (ações que derrubam acesso). */
export function ConfirmarBotao({ mensagem, children }: { mensagem: string; children: ReactNode }) {
  return (
    <button className="underline" onClick={(e) => { if (!window.confirm(mensagem)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
