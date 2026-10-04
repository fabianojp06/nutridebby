'use client';

import { useActionState } from 'react';
import type { Tema } from '@/modules/plataforma/preferencias-tipos';
import { escolherTemaAction, type TemaState } from '../preferencias/actions';

const OPCOES: { valor: Tema; rotulo: string }[] = [
  { valor: 'claro', rotulo: 'Claro' },
  { valor: 'escuro', rotulo: 'Escuro' },
  { valor: 'sistema', rotulo: 'Igual ao aparelho' },
];

export function TemaForm({ tema }: { tema: Tema }) {
  const [state, action, pendente] = useActionState<TemaState, FormData>(escolherTemaAction, {});
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="font-medium">Tema</legend>
        {OPCOES.map((o) => (
          <label key={o.valor} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="tema" value={o.valor} defaultChecked={tema === o.valor} />
            {o.rotulo}
          </label>
        ))}
      </fieldset>
      <button disabled={pendente} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Salvar tema</button>
      {state.erro && <p role="alert" className="text-erro">{state.erro}</p>}
      {state.ok && <p role="status">Tema salvo.</p>}
    </form>
  );
}
