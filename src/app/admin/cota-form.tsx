'use client';

import { useActionState } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import { ajustarCotaAction, type CotaState } from './actions';

export function CotaForm({ tenantId, cota, conta }: { tenantId: string; cota: number; conta: string }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaAction.bind(null, tenantId), {});
  const id = `cota-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="w-full text-sm font-medium">Cota mensal de WhatsApp<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={id} name="cota" inputMode="numeric" defaultValue={cota} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="min-h-11 w-28 rounded-xl border border-campo bg-cartao px-3" />
      <button disabled={pendente} className={classeDoBotao('secundario')}>Salvar<span className="sr-only">{` a cota de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="w-full text-sm text-erro">{state.erro}</span>}
      {state.ok && <span role="status" className="text-sm">Salvo</span>}
    </form>
  );
}
