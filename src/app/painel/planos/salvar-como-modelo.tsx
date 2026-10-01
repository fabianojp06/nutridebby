'use client';

import { useActionState } from 'react';
import type { ModeloState } from './modelos/actions';

/** US-024 "Salvar como modelo" (disponível em qualquer versão do plano). */
export function SalvarComoModelo({ acao, tituloSugerido }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; tituloSugerido: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="titulo-modelo" className="block text-sm">Nome do modelo</label>
        <input id="titulo-modelo" name="titulo" defaultValue={tituloSugerido} className="rounded border p-2" />
      </div>
      <button disabled={pendente} className="rounded border px-4 py-2">Salvar como modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full text-sm text-emerald-800">{state.ok}</p>}
    </form>
  );
}
