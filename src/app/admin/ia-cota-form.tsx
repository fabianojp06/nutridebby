'use client';

import { useActionState } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import { ajustarCotaIaAction, type CotaState } from './actions';

export function IaCotaForm({ tenantId, cota, conta }: { tenantId: string; cota: number; conta: string }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaIaAction.bind(null, tenantId), {});
  const id = `cota-ia-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="w-full text-sm font-medium">Limite de IA (US$/mês)<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={id} name="cotaIa" inputMode="decimal" defaultValue={String(cota).replace('.', ',')} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="min-h-11 w-28 rounded-xl border border-campo bg-cartao px-3" />
      <button disabled={pendente} className={classeDoBotao('secundario')}>Salvar<span className="sr-only">{` o limite de IA de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="w-full text-sm text-erro">{state.erro}</span>}
      {state.ok && <span role="status" className="text-sm">Salvo</span>}
    </form>
  );
}
