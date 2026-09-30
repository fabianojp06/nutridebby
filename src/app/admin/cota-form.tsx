'use client';

import { useActionState } from 'react';
import { ajustarCotaAction, type CotaState } from './actions';

export function CotaForm({ tenantId, cota, conta }: { tenantId: string; cota: number; conta: string }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaAction.bind(null, tenantId), {});
  const id = `cota-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <label htmlFor={id} className="sr-only">{`Cota mensal de WhatsApp de ${conta}`}</label>
      <input id={id} name="cota" inputMode="numeric" defaultValue={cota} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="w-24 rounded border p-1" />
      <button disabled={pendente} className="underline">Salvar<span className="sr-only">{` a cota de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="text-red-700">{state.erro}</span>}
      {state.ok && <span role="status">Salvo</span>}
    </form>
  );
}
