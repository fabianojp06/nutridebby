'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import type { EstadoForm } from '../actions';

/**
 * Botão de uma ação do documento, com confirmação opcional. O erro volta aqui (role="alert"); o sucesso aparece na página
 * revalidada ou no aviso do redirect ("Rascunho apagado.", "Link reenviado.") — como BotaoAcao do plano alimentar.
 */
export function AcaoDocumento({ acao, rotulo, confirmar, secundario = false }: { acao: (prev: EstadoForm) => Promise<EstadoForm>; rotulo: string; confirmar?: string; secundario?: boolean }) {
  const [s, action, pendente] = useActionState<EstadoForm>(acao, {});
  const erro = Object.values(s.erros ?? {})[0];
  return (
    <form action={action} className="space-y-1" onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }}>
      {secundario ? (
        <Botao variante="secundario" disabled={pendente}>{rotulo}</Botao>
      ) : (
        <button disabled={pendente} className="inline-flex min-h-11 items-center text-link underline disabled:opacity-50">{rotulo}</button>
      )}
      {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
    </form>
  );
}
