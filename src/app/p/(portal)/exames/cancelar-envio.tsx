'use client';
import { useActionState } from 'react';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { cancelarEnvioAction, type CancelarState } from './actions';

/**
 * US-161: "Cancelar envio" — no "recebido" pede a confirmação da spec; no "processando" não pede e a ação só confere
 * (nunca cancela): "Aguarde…" ou, se já terminou, a lista refeita com o botão que confirma.
 */
export function CancelarEnvio({ id, processando, rotulo }: { id: string; processando: boolean; rotulo: string }) {
  const [state, action, pendente] = useActionState<CancelarState, FormData>(cancelarEnvioAction.bind(null, id, processando), {});
  const idErro = `cancelar-erro-${id}`;
  return (
    <form action={action} className="space-y-1">
      <button
        disabled={pendente}
        aria-describedby={state.erro ? idErro : undefined}
        className="inline-flex min-h-11 items-center underline"
        onClick={(e) => {
          if (!processando && !window.confirm(MSG_ENVIO.confirmarCancelar)) e.preventDefault();
        }}
      >
        Cancelar envio<span className="sr-only">{` ${rotulo}`}</span>
      </button>
      {state.erro && <p id={idErro} role="alert" className="text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
