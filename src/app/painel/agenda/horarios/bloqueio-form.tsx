'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { criarBloqueioAction, type FormAgendaState } from './actions';

export function BloqueioForm() {
  const [state, action, pendente] = useActionState<FormAgendaState, FormData>(criarBloqueioAction, {});
  const v = state.erros ? (state.valores ?? {}) : {};
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-2">
      <Campo id="dataInicio" rotulo="Data inicial" type="date" required defaultValue={v.dataInicio} erro={e.dataInicio} />
      <Campo id="dataFim" rotulo="Data final" type="date" defaultValue={v.dataFim} erro={e.dataFim} dica="Vazio = só a data inicial." />
      <Campo id="horaInicio" rotulo="Hora inicial (opcional)" type="time" defaultValue={v.horaInicio} erro={e.horaInicio} dica="Vazio = o dia inteiro." />
      <Campo id="horaFim" rotulo="Hora final (opcional)" type="time" defaultValue={v.horaFim} erro={e.horaFim} />
      <div className="sm:col-span-2">
        <Campo id="motivo" rotulo="Motivo (opcional)" maxLength={120} defaultValue={v.motivo} erro={e.motivo} />
      </div>
      <div className="sm:col-span-2">
        {state.ok && <p role="status">{state.ok}</p>}
        <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Adicionar bloqueio</button>
      </div>
    </form>
  );
}
