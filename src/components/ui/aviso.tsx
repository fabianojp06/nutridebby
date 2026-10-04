import type { ReactNode } from 'react';

const ESTILO = { erro: 'border-erro bg-erro-fundo text-erro', aviso: 'border-aviso bg-aviso-fundo text-aviso', ok: 'border-ok bg-ok-fundo text-ok' } as const;

/** Mensagens do topo das telas (cota, WhatsApp, sucesso). Erro anuncia na hora (alert); o resto, educado (status). */
export function Aviso({ tipo, papel, children }: { tipo: keyof typeof ESTILO; papel?: 'alert' | 'status'; children?: ReactNode }) {
  return (
    <p role={papel ?? (tipo === 'erro' ? 'alert' : 'status')} className={`rounded-2xl border p-3 ${ESTILO[tipo]}`}>
      {children}
    </p>
  );
}
