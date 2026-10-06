'use client';

import { useActionState } from 'react';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_IA } from '@/modules/ia/constantes';
import { ativarIaAction, type AtivarIaState } from './actions';

export function IaAtivarForm({ versao, rotulo }: { versao: string; rotulo: string }) {
  const [state, action, pendente] = useActionState<AtivarIaState, FormData>(ativarIaAction, {});
  if (state.ok) return <Aviso tipo="ok">{MSG_IA.iaAtivada}</Aviso>;
  return (
    <form action={action} className="space-y-2">
      <label className="flex items-start gap-2">
        <input type="checkbox" name="aceite" value="1" className="mt-1 h-6 w-6" aria-invalid={state.erro ? true : undefined} aria-describedby={state.erro ? 'ia-erro' : undefined} />
        {`Li e aceito o aditivo de inteligência artificial (versão ${versao})`}
      </label>
      {state.erro && <p id="ia-erro" role="alert" className="text-erro">{state.erro}</p>}
      <Botao disabled={pendente}>{rotulo}</Botao>
    </form>
  );
}
