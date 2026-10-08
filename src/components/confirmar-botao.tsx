'use client';

import type { ReactNode } from 'react';

/** Botão de envio que pede confirmação antes (ações que derrubam acesso ou apagam registro). `className`: o visual (padrão: link). */
export function ConfirmarBotao({ mensagem, children, rotulo, className = 'text-link underline' }: { mensagem: string; children: ReactNode; rotulo?: string; className?: string }) {
  return (
    <button className={className} aria-label={rotulo} onClick={(e) => { if (!window.confirm(mensagem)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
