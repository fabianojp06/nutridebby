'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { salvarChaveAction, type ChaveState } from './actions';

const M = MSG_SOLICITACOES.chave;

/**
 * Plano 23 (US-407, §6.2 "Horários"): "Confirmar os pedidos antes de marcar", com a explicação ligada à caixa e a volta
 * "Configuração salva." numa região `role="status"` que fica sempre montada (o texto que muda é anunciado). O estado
 * marcado vem do servidor depois de salvar (`ligada` da página refeita pelo `revalidatePath`; o `key` remonta a caixa).
 */
export function ChaveDosPedidosForm({ ligada }: { ligada: boolean }) {
  const [state, action, pendente] = useActionState<ChaveState, FormData>(salvarChaveAction, {});
  return (
    <form action={action} className="space-y-2">
      <label className="inline-flex min-h-11 items-center gap-2">
        <input key={String(ligada)} type="checkbox" name="confirmar" defaultChecked={ligada} aria-describedby="chave-pedidos-ajuda" />
        {M.rotulo}
      </label>
      <p id="chave-pedidos-ajuda" className="text-sm text-suave">{M.ajuda}</p>
      {state.erro && <p role="alert" className="text-erro">{state.erro}</p>}
      <p role="status">{state.ok ?? ''}</p>
      <Botao type="submit" disabled={pendente}>{M.salvar}</Botao>
    </form>
  );
}
