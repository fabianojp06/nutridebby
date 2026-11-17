'use client';

import { useActionState } from 'react';
import type { ExclusaoState } from './actions';

/** `instrucao`: o rótulo do campo quando a página pede outro texto (com nome social, o nome de registro — RN-266). */
export function ExclusaoForm({
  acao,
  instrucao = 'Digite o nome do paciente para confirmar',
}: {
  acao: (prev: ExclusaoState, formData: FormData) => Promise<ExclusaoState>;
  instrucao?: string;
}) {
  const [state, action, pendente] = useActionState<ExclusaoState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="confirmacao" className="block font-medium">
        {instrucao}
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
