'use client';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { useOnline } from '@/components/portal/online';
import { confirmarAction, type AgendaState } from '../agenda/actions';

/**
 * US-191 "Consulta próxima": a mesma ação da tela da consulta (Plano 05); depois, o mural é buscado de novo. Correção da
 * revisão do plano (RNF-191, memória "mensagem de sucesso desmontada", Plano 11 T14): o componente fica montado em todo item
 * de consulta (o refresh devolve podeConfirmar = false e o botão some, mas o estado e a região viva continuam); a região
 * role="status" está SEMPRE montada e só o texto muda; o foco, que estava no botão que saiu, vai para a confirmação.
 */
export function ConfirmarNoMural({ id, podeConfirmar }: { id: string; podeConfirmar: boolean }) {
  const router = useRouter();
  const online = useOnline();
  const aviso = useRef<HTMLParagraphElement>(null);
  const [estado, confirmar, confirmando] = useActionState<AgendaState>(async () => {
    const r = await confirmarAction(id);
    if (r.ok) router.refresh();
    return r;
  }, {});
  useEffect(() => {
    if (estado.ok) aviso.current?.focus();
  }, [estado.ok]);
  return (
    <form action={confirmar} className="space-y-1">
      {podeConfirmar && !estado.ok && (
        <button disabled={confirmando || !online} className="min-h-11 rounded-full bg-destaque px-4 font-semibold text-white disabled:opacity-60">Confirmar presença</button>
      )}
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <p ref={aviso} tabIndex={-1} role="status" className="text-sm">{estado.ok ?? ''}</p>
    </form>
  );
}
