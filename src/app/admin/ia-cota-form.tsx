'use client';

import { useActionState } from 'react';
import { ajustarCotaIaAction, type CotaState } from './actions';

export function IaCotaForm({ tenantId, cota, conta }: { tenantId: string; cota: number; conta: string }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaIaAction.bind(null, tenantId), {});
  const id = `cota-ia-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <label htmlFor={id} className="text-sm">Limite de IA (US$/mês)<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={id} name="cotaIa" inputMode="decimal" defaultValue={String(cota).replace('.', ',')} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="w-20 rounded border p-1" />
      <button disabled={pendente} className="underline">Salvar<span className="sr-only">{` o limite de IA de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="text-red-700">{state.erro}</span>}
      {state.ok && <span role="status">Salvo</span>}
    </form>
  );
}
