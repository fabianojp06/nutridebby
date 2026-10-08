'use client';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { MSG_COMI_ASSIM } from './comi-assim-estado';
import { useOnline } from './online';

/** As respostas que levam ao formulário do diário: sem rede, desabilitadas (aria-disabled, sem href) com o mesmo aviso do "Comi assim". */
export function LinkDeResposta({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const online = useOnline();
  const aviso = useId();
  if (online) return <Link href={href} className={className}>{children}</Link>;
  return (
    <span className="space-y-1">
      <a role="link" aria-disabled="true" aria-describedby={aviso} className={`${className} opacity-60`}>{children}</a>
      <span id={aviso} className="block text-sm text-suave">{MSG_COMI_ASSIM.semConexao}</span>
    </span>
  );
}
