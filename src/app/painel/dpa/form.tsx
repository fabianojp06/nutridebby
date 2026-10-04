'use client';

import { useActionState } from 'react';
import { aceitarDpaAction, type DpaState } from '../actions';

const ERRO_ID = 'erro-dpa';

export function DpaForm() {
  const [state, action, pendente] = useActionState<DpaState, FormData>(aceitarDpaAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex items-start gap-2">
        <input
          id="dpa"
          name="dpa"
          type="checkbox"
          className="mt-1"
          aria-invalid={state.erro ? true : undefined}
          aria-describedby={state.erro ? ERRO_ID : undefined}
        />
        <label htmlFor="dpa">Li e aceito o contrato de tratamento de dados (DPA)</label>
      </div>
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Aceitar e continuar</button>
    </form>
  );
}
