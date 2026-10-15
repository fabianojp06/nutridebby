'use client';

import { useActionState } from 'react';
import { aceitarDpaAction, type DpaState } from '../actions';

const ERRO_ID = 'erro-dpa';

/** `rotulo` vem da página (servidor): o módulo do DPA importa o banco e não entra no bundle do navegador. */
export function DpaForm({ rotulo }: { rotulo: string }) {
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
        <label htmlFor="dpa">{rotulo}</label>
      </div>
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Aceitar e continuar</button>
    </form>
  );
}
