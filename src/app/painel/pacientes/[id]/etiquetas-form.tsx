'use client';

import { useActionState } from 'react';
import type { Etiqueta } from '@/modules/pacientes/etiquetas';
import type { EtiquetasState } from '../actions';

type Props = {
  acao: (prev: EtiquetasState, formData: FormData) => Promise<EtiquetasState>;
  todas: Etiqueta[];
  doPaciente: string[];
  somenteLeitura: boolean;
};

export function EtiquetasForm({ acao, todas, doPaciente, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<EtiquetasState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={somenteLeitura} className="space-y-2">
        <legend className="sr-only">Etiquetas do paciente</legend>
        {todas.length === 0 && <p className="text-sm text-suave">Nenhuma etiqueta criada ainda.</p>}
        {todas.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            <input id={`etiqueta-${e.id}`} name="etiquetas" type="checkbox" value={e.id} defaultChecked={doPaciente.includes(e.id)} />
            <label htmlFor={`etiqueta-${e.id}`}>{e.nome}</label>
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor="nova" className="block font-medium">Nova etiqueta</label>
          <input id="nova" name="nova" maxLength={40} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" aria-describedby={state.erro ? 'etiquetas-erro' : undefined} />
        </div>
      </fieldset>
      {state.erro && <p id="etiquetas-erro" role="alert" className="text-erro">{state.erro}</p>}
      {state.ok && <p role="status">Etiquetas salvas.</p>}
      {!somenteLeitura && <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">Salvar etiquetas</button>}
    </form>
  );
}
