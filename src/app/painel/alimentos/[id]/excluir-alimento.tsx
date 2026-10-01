'use client';

import { useActionState } from 'react';
import type { AlimentoState } from '../actions';

export function ExcluirAlimento({ acao }: { acao: (s: AlimentoState) => Promise<AlimentoState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm('Excluir este alimento?')) e.preventDefault(); }}>
      <button disabled={pendente} className="underline">Excluir</button>
      {state.erros?.geral && <p role="alert" className="text-sm text-red-700">{state.erros.geral}</p>}
    </form>
  );
}
