'use client';

import { useActionState } from 'react';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import type { PedidoIaState } from './actions';

const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

/**
 * US-105: o botão, ou — com um pedido aberto — "Já há um pedido por e-mail válido até…"; o retorno ("Pedido enviado. O link
 * vale por 7 dias.") numa região role="status" que existe desde o início (RNF-10) e continua montada depois do revalidatePath.
 */
export function PedidoIaForm({ acao, aberto }: { acao: (prev: PedidoIaState, fd: FormData) => Promise<PedidoIaState>; aberto: string | null }) {
  const [state, action, pendente] = useActionState<PedidoIaState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-2">
      {aberto ? (
        <p>{aberto}</p>
      ) : (
        <button disabled={pendente} className={BOTAO}>
          {MSG_AUTORIZACAO.enviarPedido}
        </button>
      )}
      <p role="status">{state.ok ?? ''}</p>
      {state.erro && (
        <p role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
    </form>
  );
}
