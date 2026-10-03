'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { ConsultaState } from '../../actions';

/** US-033: cancelar pela nutricionista, com motivo opcional (só ela vê) e confirmação antes. */
export function CancelarForm({ acao }: { acao: (prev: ConsultaState, fd: FormData) => Promise<ConsultaState> }) {
  const [state, action, pendente] = useActionState<ConsultaState, FormData>(acao, {});
  const e = state.erros ?? {};
  return (
    <form action={action} className="max-w-xl space-y-3" onSubmit={(ev) => { if (!window.confirm('Cancelar esta consulta? O paciente recebe um aviso por e-mail.')) ev.preventDefault(); }}>
      <Campo id="motivo" rotulo="Motivo do cancelamento (opcional)" maxLength={300} defaultValue={state.valores?.motivo} erro={e.motivo} dica="Só você vê." />
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded border border-red-700 px-4 py-2 text-red-800">Cancelar consulta</button>
    </form>
  );
}
