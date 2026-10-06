'use client';

import { useActionState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { reiniciar2faAction, type Reiniciar2faState } from './actions';

const CONFIRMAR = 'Reiniciar a verificação em duas etapas desta conta? O app autenticador e os códigos de recuperação dela deixam de valer, as sessões abertas caem e a pessoa recebe um e-mail.';

/**
 * Code review do PR #22: o código do 2FA da própria admin (item 1) e o reset automático do React 19 depois da ação
 * (item 8): o e-mail volta como `defaultValue` só na recusa; o código nunca volta.
 */
export function Reiniciar2faForm() {
  const [state, action, pendente] = useActionState<Reiniciar2faState, FormData>(reiniciar2faAction, {});
  const erroEm = (c: 'email' | 'codigo') => (state.erro && state.campo === c ? { 'aria-invalid': true, 'aria-describedby': 'reiniciar-2fa-erro' } : {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="email-2fa" className="block text-sm font-medium">E-mail da conta</label>
        <input id="email-2fa" name="email" type="email" autoComplete="off" required defaultValue={state.valor} {...erroEm('email')}
          className="min-h-11 w-72 rounded border p-2" />
      </div>
      <div className="space-y-1">
        <label htmlFor="codigo-2fa-admin" className="block text-sm font-medium">Seu código da verificação em duas etapas</label>
        <input id="codigo-2fa-admin" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required {...erroEm('codigo')}
          className="min-h-11 w-40 rounded border p-2" />
      </div>
      <fieldset disabled={pendente} className="m-0 min-w-0 border-0 p-0">
        <ConfirmarBotao mensagem={CONFIRMAR}>Reiniciar verificação em duas etapas</ConfirmarBotao>
      </fieldset>
      {state.erro && <p id="reiniciar-2fa-erro" role="alert" className="w-full text-red-700">{state.erro}</p>}
      {state.ok && <p role="status" className="w-full">{state.ok}</p>}
    </form>
  );
}
