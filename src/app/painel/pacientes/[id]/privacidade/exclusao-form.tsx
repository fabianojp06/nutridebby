'use client';

import { useActionState } from 'react';
import type { ExclusaoState } from './actions';

export function ExclusaoForm({
  acao,
}: {
  acao: (prev: ExclusaoState, formData: FormData) => Promise<ExclusaoState>;
}) {
  const [state, action, pendente] = useActionState<ExclusaoState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="confirmacao" className="block font-medium">
        Digite o nome do paciente para confirmar
      </label>
      <input
        id="confirmacao"
        name="confirmacao"
        autoComplete="off"
        className="w-full max-w-md rounded-xl border border-campo bg-cartao p-2 text-texto"
        aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? 'confirmacao-erro' : undefined}
      />
      {state.erro && (
        <p id="confirmacao-erro" role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="rounded-full border border-erro bg-erro-fundo px-4 py-2 font-semibold text-erro">
        Atender pedido de exclusão
      </button>
    </form>
  );
}
