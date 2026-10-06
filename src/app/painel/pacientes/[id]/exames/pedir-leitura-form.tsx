'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { pedirLeituraAction, type PedidoState } from './actions';

export function PedirLeituraForm({ patientId, examId, titulo }: { patientId: string; examId: string; titulo: string }) {
  const [state, action, pendente] = useActionState<PedidoState, FormData>(pedirLeituraAction.bind(null, patientId, examId), {});
  const idErro = `ia-erro-${examId}`;
  return (
    <form action={action} className="space-y-1">
      <Botao variante="secundario" disabled={pendente} aria-describedby={state.erro ? idErro : undefined}>
        Ler valores com IA<span className="sr-only">{` do exame ${titulo}`}</span>
      </Botao>
      {state.erro && <p id={idErro} role="alert" className="text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
