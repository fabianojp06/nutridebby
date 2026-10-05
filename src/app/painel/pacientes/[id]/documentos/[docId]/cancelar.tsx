'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { cancelarAction, type EstadoForm } from '../actions';

/** US-149: o motivo fica só no prontuário; a confirmação diz que não tem volta. */
export function Cancelar({ patientId, docId, confirmacao }: { patientId: string; docId: string; confirmacao: string }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(cancelarAction.bind(null, patientId, docId), {});
  return (
    <form
      action={action}
      className="mt-4 space-y-2"
      onSubmit={(e) => {
        if (!window.confirm(confirmacao)) e.preventDefault();
      }}
      data-guia="cancelar-documento"
    >
      <label htmlFor="motivo" className="block font-medium">Motivo do cancelamento</label>
      <textarea
        id="motivo"
        name="motivo"
        maxLength={500}
        required
        aria-describedby={s.erros?.motivo ? 'motivo-dica motivo-erro' : 'motivo-dica'}
        aria-invalid={s.erros?.motivo ? true : undefined}
        className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
      />
      <p id="motivo-dica" className="text-sm text-suave">Fica só no prontuário.</p>
      {s.erros?.motivo && <p id="motivo-erro" role="alert" className="text-sm text-erro">{s.erros.motivo}</p>}
      {s.erros?.geral && <p role="alert" className="text-erro">{s.erros.geral}</p>}
      <Botao variante="secundario" disabled={pendente}>Cancelar documento</Botao>
    </form>
  );
}
