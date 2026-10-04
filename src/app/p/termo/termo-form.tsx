'use client';
import { useActionState, useState } from 'react';
import { TERMO_PACIENTE_ROTULO } from '@/modules/pacientes/termo-paciente';
import { aceitarTermoAction } from './actions';

/** US-011 "Consentimento obrigatório": "Continuar" fica desabilitado até marcar, como no aceite do convite. `volta`: S-1. */
export function TermoForm({ volta }: { volta: string }) {
  const [estado, enviar, enviando] = useActionState(aceitarTermoAction, {});
  const [marcado, setMarcado] = useState(false);
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="volta" value={volta} />
      <div className="flex items-start gap-2">
        <input id="aceite" name="aceite" type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} className="mt-1 size-5" />
        <label htmlFor="aceite">{TERMO_PACIENTE_ROTULO}</label>
      </div>
      {estado.erro && (
        <p role="alert" className="text-erro">
          {estado.erro}
        </p>
      )}
      <button disabled={!marcado || enviando} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white disabled:opacity-50">
        Continuar
      </button>
    </form>
  );
}
