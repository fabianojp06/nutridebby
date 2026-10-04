'use client';
import { useActionState, useState } from 'react';
import { whatsappAction, type PerfilState } from './actions';

/** "Perfil > Notificações": "Receber lembretes por WhatsApp" (US-011, D20). */
export function WhatsappForm({ ativo }: { ativo: boolean }) {
  // T-6: controlada — depois de um erro (ex.: sem telefone) a caixa volta ao que está salvo, não fica marcada
  const [marcada, setMarcada] = useState(ativo);
  const [s, enviar, enviando] = useActionState<PerfilState, FormData>(async (anterior, dados) => {
    const r = await whatsappAction(anterior, dados);
    if (r.erro) setMarcada(ativo);
    return r;
  }, {});
  return (
    <form action={enviar} className="space-y-2">
      <div className="flex min-h-11 items-center gap-2">
        <input
          id="whatsapp"
          name="whatsapp"
          type="checkbox"
          checked={marcada}
          onChange={(e) => setMarcada(e.target.checked)}
          aria-invalid={s.erro ? true : undefined}
          aria-describedby={s.erro ? 'whatsapp-erro' : undefined}
          className="size-5"
        />
        <label htmlFor="whatsapp">Receber lembretes por WhatsApp</label>
      </div>
      {s.erro && (
        <p id="whatsapp-erro" role="alert" className="text-erro">
          {s.erro}
        </p>
      )}
      {/* RNF-10: sempre montada, só o texto muda (região viva criada já com o texto pode não ser anunciada) */}
      <p role="status">{s.ok}</p>
      <button disabled={enviando} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">
        Salvar
      </button>
    </form>
  );
}
