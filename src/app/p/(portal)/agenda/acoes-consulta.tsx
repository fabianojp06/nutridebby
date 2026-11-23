'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import { avisarAction, cancelarAction, confirmarAction, desistirAction, type AgendaState } from './actions';

const Retorno = ({ s }: { s: AgendaState }) => (s.erro ? <p role="alert" className="text-erro">{s.erro}</p> : s.ok ? <p role="status" className="rounded bg-ok-fundo p-3">{s.ok}</p> : null);

/** US-033 / US-035 no PWA: confirmar; dentro do prazo, cancelar; fora dele, só avisar a nutricionista (RN-04). */
export function AcoesConsulta({ id, confirmada, podeAlterar, pedidoRemarcacao }: { id: string; confirmada: boolean; podeAlterar: boolean; pedidoRemarcacao: boolean }) {
  const [conf, confirmar, confirmando] = useActionState<AgendaState>(confirmarAction.bind(null, id), {});
  const [canc, cancelar, cancelando] = useActionState<AgendaState>(cancelarAction.bind(null, id), {});
  const [avis, avisar, avisando] = useActionState<AgendaState>(avisarAction.bind(null, id), {});
  return (
    <div className="space-y-3">
      {!confirmada && (
        <form action={confirmar}>
          <button disabled={confirmando} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">Confirmar presença</button>
        </form>
      )}
      <Retorno s={conf} />
      {podeAlterar ? (
        <form action={cancelar} onSubmit={(e) => { if (!window.confirm('Cancelar esta consulta?')) e.preventDefault(); }}>
          <button disabled={cancelando} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">Cancelar consulta</button>
        </form>
      ) : (
        <>
          <p>Para alterar, fale com sua nutricionista.</p>
          {!pedidoRemarcacao && (
            <form action={avisar}>
              <button disabled={avisando} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">Avisar que preciso remarcar</button>
            </form>
          )}
        </>
      )}
      <Retorno s={canc} />
      <Retorno s={avis} />
    </div>
  );
}

const P = MSG_SOLICITACOES.portal;

/** O formulário dentro da confirmação: "Voltar" e "Desistir do pedido" (o `<form>` dentro do diálogo, nunca o contrário). */
function FormularioDaDesistencia({ id, aoVoltar, aoMudarPendente }: { id: string; aoVoltar: () => void; aoMudarPendente: (p: boolean) => void }) {
  const [s, desistir, pendente] = useActionState<AgendaState>(desistirAction.bind(null, id), {});
  useEffect(() => aoMudarPendente(pendente), [pendente, aoMudarPendente]);
  return (
    <form action={desistir} className="space-y-3">
      <Retorno s={s} />
      <div className="flex flex-wrap justify-end gap-3">
        <Botao type="button" variante="secundario" onClick={() => !pendente && aoVoltar()} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60">Voltar</Botao>
        <Botao type="submit" variante="escuro" aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" onClick={(e) => pendente && e.preventDefault()} data-foco-inicial="">{P.desistir}</Botao>
      </div>
    </form>
  );
}

/**
 * Plano 23 (US-408, AG-D42): o pedido ainda aguardando — "Desistir do pedido" abre a confirmação "Desistir deste pedido?" no
 * `Dialogo` compartilhado (Plano 22). Confirmado, a action volta a "Minhas consultas" com "Pedido cancelado." (região fixa,
 * com o foco). Alvo de 44 px (portal).
 */
export function DesistirDoPedido({ id }: { id: string }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const idBotao = useId();
  return (
    <div>
      <Botao id={idBotao} type="button" variante="secundario" aria-haspopup="dialog" onClick={() => setAberto(true)}>{P.desistir}</Botao>
      <Dialogo aberto={aberto} titulo={P.desistirConfirma} aoFechar={() => setAberto(false)} ocupado={ocupado} rodape={null} focoAoFechar={() => document.getElementById(idBotao)}>
        <FormularioDaDesistencia id={id} aoVoltar={() => setAberto(false)} aoMudarPendente={setOcupado} />
      </Dialogo>
    </div>
  );
}
