'use client';

import { useActionState } from 'react';
import { useStatusSalvamento } from '@/app/painel/planos/editor/salvamento-contexto';
import type { AcaoPlanoState } from './actions';

/**
 * `exigirSalvo`: dentro do editor, fica desabilitado enquanto o salvamento automático não terminou
 * (o status "Salvando…", "Alterações não salvas" ou o erro já está na linha do editor).
 */
export function BotaoAcao({ acao, rotulo, confirmar, principal = true, exigirSalvo = false }: { acao: (s: AcaoPlanoState) => Promise<AcaoPlanoState>; rotulo: string; confirmar?: string; principal?: boolean; exigirSalvo?: boolean }) {
  const [state, action, pendente] = useActionState(acao, {});
  const salvamento = useStatusSalvamento();
  const aguardando = exigirSalvo && salvamento !== 'salvo';
  return (
    <form action={action} onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }} className="space-y-1">
      <button disabled={pendente || aguardando} className={`${principal ? 'inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95' : 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha'} disabled:opacity-50`}>{rotulo}</button>
      {aguardando && salvamento !== 'salvando' && <p className="text-sm text-suave">Só dá para continuar com as alterações salvas.</p>}
      {state.erro && <p role="alert" className="text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
