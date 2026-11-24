'use client';

import { useActionState, useEffect, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { salvarChaveAction, type ChaveState } from './actions';

const M = MSG_SOLICITACOES.chave;
/** Quanto a região fica vazia antes de o mesmo texto voltar (o leitor de tela só anuncia o que muda), como `Mensagens`. */
const PAUSA_MS = 100;

/**
 * Plano 23 (US-407, §6.2 "Horários"): "Confirmar os pedidos antes de marcar", com a explicação ligada à caixa e a volta
 * "Configuração salva." numa região `role="status"` sempre montada. Revisão da T8: cada salvamento (o `envio` da action)
 * esvazia a região por um instante e repõe o texto (salvar de novo é anunciado de novo); mexer na caixa limpa o aviso (ele
 * falaria de um estado que já não é o da tela); durante o envio o botão fica `aria-disabled` (o foco não sai dele). O estado
 * marcado vem do servidor depois de salvar (`ligada` da página refeita pelo `revalidatePath`; o `key` remonta a caixa).
 */
export function ChaveDosPedidosForm({ ligada }: { ligada: boolean }) {
  const [state, action, pendente] = useActionState<ChaveState, FormData>(salvarChaveAction, {});
  const [visto, setVisto] = useState(state.envio);
  const [vazia, setVazia] = useState(false);
  const [mexeu, setMexeu] = useState(false);
  if (visto !== state.envio) {
    setVisto(state.envio);
    setVazia(true);
    setMexeu(false);
  }
  useEffect(() => {
    if (!vazia) return;
    const t = setTimeout(() => setVazia(false), PAUSA_MS);
    return () => clearTimeout(t);
  }, [vazia]);
  const texto = vazia || mexeu ? '' : (state.ok ?? '');
  return (
    <form action={action} className="space-y-2">
      <label className="inline-flex min-h-11 items-center gap-2">
        <input key={String(ligada)} type="checkbox" name="confirmar" defaultChecked={ligada} aria-describedby="chave-pedidos-ajuda" onChange={() => setMexeu(true)} />
        {M.rotulo}
      </label>
      <p id="chave-pedidos-ajuda" className="text-sm text-suave">{M.ajuda}</p>
      <p role="status">{texto}</p>
      <Botao type="submit" aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" onClick={(e) => pendente && e.preventDefault()}>{M.salvar}</Botao>
    </form>
  );
}
