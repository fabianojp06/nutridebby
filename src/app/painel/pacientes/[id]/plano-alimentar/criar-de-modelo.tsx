'use client';

import { useActionState } from 'react';
import type { ModeloState } from '@/app/painel/planos/modelos/actions';

export function CriarDeModelo({ acao, modelos }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; modelos: { id: string; titulo: string }[] }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="modelo" className="block text-sm">Modelo</label>
        <select id="modelo" name="modelo" className="rounded border p-2">
          {modelos.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
        </select>
      </div>
      <button disabled={pendente} className="rounded border px-4 py-2">Criar a partir de modelo</button>
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
    </form>
  );
}
