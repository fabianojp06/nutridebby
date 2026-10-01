'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { MedidaState } from './actions';

/** US-020 "Cadastrar medida caseira": grava em food_measures do tenant. */
export function MedidaForm({ acao }: { acao: (s: MedidaState, fd: FormData) => Promise<MedidaState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
      <Campo id="medida-nome" name="nome" rotulo="Medida (singular)" placeholder="pires pequeno" erro={e.nome} />
      <Campo id="medida-plural" name="plural" rotulo="Plural" placeholder="pires pequenos" />
      <Campo id="medida-gramas" name="gramas" rotulo="Gramas" inputMode="decimal" erro={e.gramas} />
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Cadastrar medida caseira</button>
      {e.geral && <p role="alert" className="text-red-700 sm:col-span-4">{e.geral}</p>}
      {state.ok && <p role="status" className="text-emerald-800 sm:col-span-4">{state.ok}</p>}
    </form>
  );
}
