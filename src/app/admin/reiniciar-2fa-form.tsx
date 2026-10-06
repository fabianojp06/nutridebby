'use client';

import { useActionState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { reiniciar2faAction, type Reiniciar2faState } from './actions';

const CONFIRMAR = 'Reiniciar a verificação em duas etapas desta conta? O app autenticador e os códigos de recuperação dela deixam de valer, as sessões abertas caem e a pessoa recebe um e-mail.';

export function Reiniciar2faForm() {
  const [state, action, pendente] = useActionState<Reiniciar2faState, FormData>(reiniciar2faAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="email-2fa" className="block text-sm font-medium">E-mail da conta</label>
        <input id="email-2fa" name="email" type="email" autoComplete="off" required defaultValue={state.valor} key={state.ok ?? state.valor}
          aria-invalid={state.erro ? true : undefined} aria-describedby={state.erro ? 'email-2fa-erro' : undefined}
          className="min-h-11 w-72 rounded border p-2" />
      </div>
      <fieldset disabled={pendente} className="m-0 min-w-0 border-0 p-0">
        <ConfirmarBotao mensagem={CONFIRMAR}>Reiniciar verificação em duas etapas</ConfirmarBotao>
      </fieldset>
      {state.erro && <p id="email-2fa-erro" role="alert" className="w-full text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full">{state.ok}</p>}
    </form>
  );
}
