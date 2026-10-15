'use client';

import { useActionState } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import { ajustarCotaIaNutriAction, type CotaState } from './actions';

/** Plano 15 (D3, §13.2): a cota própria da IA Nutri (escopo `paciente`, US$ 7 por padrão), no molde do "Limite de IA". */
export function IaNutriCotaForm({ tenantId, cota, conta }: { tenantId: string; cota: number; conta: string }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaIaNutriAction.bind(null, tenantId), {});
  const id = `cota-ia-nutri-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="w-full text-sm font-medium">Limite da IA Nutri (US$/mês)<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={id} name="cotaIaNutri" inputMode="decimal" defaultValue={String(cota).replace('.', ',')} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="min-h-11 w-28 rounded-xl border border-campo bg-cartao px-3" />
      <button disabled={pendente} className={classeDoBotao('secundario')}>Salvar<span className="sr-only">{` o limite da IA Nutri de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="w-full text-sm text-erro">{state.erro}</span>}
      {state.ok && <span role="status" className="text-sm">Salvo</span>}
    </form>
  );
}
