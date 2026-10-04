'use client';

import { useActionState } from 'react';
import { criarModeloAction } from './actions';

export function NovoModelo() {
  const [state, action, pendente] = useActionState(criarModeloAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="titulo" className="block font-medium">Novo modelo</label>
        <input id="titulo" name="titulo" placeholder="Emagrecimento 1600 kcal" className="rounded-xl border border-campo bg-cartao p-2 text-texto" />
      </div>
      <button disabled={pendente} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Criar modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
