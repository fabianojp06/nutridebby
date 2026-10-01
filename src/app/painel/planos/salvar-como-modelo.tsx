'use client';

import { useActionState } from 'react';
import { useStatusSalvamento } from './editor/salvamento-contexto';
import type { ModeloState } from './modelos/actions';

/**
 * US-024 "Salvar como modelo" (disponível em qualquer versão do plano). Copia o que está no banco: como o "Publicar",
 * fica desabilitado enquanto o salvamento automático do editor não terminou.
 */
export function SalvarComoModelo({ acao, tituloSugerido }: { acao: (s: ModeloState, fd: FormData) => Promise<ModeloState>; tituloSugerido: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const salvamento = useStatusSalvamento();
  const aguardando = salvamento !== 'salvo';
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="titulo-modelo" className="block text-sm">Nome do modelo</label>
        <input id="titulo-modelo" name="titulo" defaultValue={tituloSugerido} className="rounded border p-2" />
      </div>
      <button disabled={pendente || aguardando} className="rounded border px-4 py-2 disabled:opacity-50">Salvar como modelo</button>
      {aguardando && salvamento !== 'salvando' && <p className="w-full text-sm text-zinc-600">Só dá para continuar com as alterações salvas.</p>}
      {state.erro && <p role="alert" className="w-full text-sm text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full text-sm text-emerald-800">{state.ok}</p>}
    </form>
  );
}
