import type { ReactNode } from 'react';

const ESTILO = {
  erro: 'rounded-2xl border border-erro bg-erro-fundo p-3 text-erro',
  aviso: 'rounded-2xl border border-aviso bg-aviso-fundo p-3 text-aviso',
  ok: 'rounded-2xl border border-ok bg-ok-fundo p-3 text-ok',
} as const;

/** Mensagens do topo das telas (cota, WhatsApp, sucesso). Erro anuncia na hora (alert); o resto, educado (status). */
export function Aviso({ tipo, papel, children }: { tipo: keyof typeof ESTILO; papel?: 'alert' | 'status'; children?: ReactNode }) {
  return (
    <p role={papel ?? (tipo === 'erro' ? 'alert' : 'status')} className={ESTILO[tipo]}>
      {children}
    </p>
  );
}
