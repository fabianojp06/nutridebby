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
        className="w-full max-w-md rounded border p-2"
        aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? 'confirmacao-erro' : undefined}
      />
      {state.erro && (
        <p id="confirmacao-erro" role="alert" className="text-red-700">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="rounded bg-red-700 px-4 py-2 text-white">
        Atender pedido de exclusão
      </button>
    </form>
  );
}
