'use client';
import { useActionState } from 'react';
import { whatsappAction, type PerfilState } from './actions';

/** "Perfil > Notificações": "Receber lembretes por WhatsApp" (US-011, D20). */
export function WhatsappForm({ ativo }: { ativo: boolean }) {
  const [s, enviar, enviando] = useActionState<PerfilState, FormData>(whatsappAction, {});
  return (
    <form action={enviar} className="space-y-2">
      <div className="flex min-h-11 items-center gap-2">
        <input
          id="whatsapp"
          name="whatsapp"
          type="checkbox"
          defaultChecked={ativo}
          aria-invalid={s.erro ? true : undefined}
          aria-describedby={s.erro ? 'whatsapp-erro' : undefined}
          className="size-5"
        />
        <label htmlFor="whatsapp">Receber lembretes por WhatsApp</label>
      </div>
      {s.erro && (
        <p id="whatsapp-erro" role="alert" className="text-red-700">
          {s.erro}
        </p>
      )}
      <p role="status">{s.ok}</p>
      <button disabled={enviando} className="min-h-11 rounded border px-4">
        Salvar
      </button>
    </form>
  );
}
