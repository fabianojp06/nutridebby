'use client';

import { useActionState } from 'react';
import type { AcaoPlanoState } from './actions';

export function BotaoAcao({ acao, rotulo, confirmar, principal = true }: { acao: (s: AcaoPlanoState) => Promise<AcaoPlanoState>; rotulo: string; confirmar?: string; principal?: boolean }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }} className="space-y-1">
      <button disabled={pendente} className={principal ? 'rounded bg-emerald-700 px-4 py-2 text-white' : 'rounded border px-4 py-2'}>{rotulo}</button>
      {state.erro && <p role="alert" className="text-sm text-red-700">{state.erro}</p>}
    </form>
  );
}
