'use client';
import { useActionState } from 'react';
import { avisarAction, cancelarAction, confirmarAction, type AgendaState } from './actions';

const Retorno = ({ s }: { s: AgendaState }) => (s.erro ? <p role="alert" className="text-red-700">{s.erro}</p> : s.ok ? <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p> : null);

/** US-033 / US-035 no PWA: confirmar; dentro do prazo, cancelar; fora dele, só avisar a nutricionista (RN-04). */
export function AcoesConsulta({ id, confirmada, podeAlterar, pedidoRemarcacao }: { id: string; confirmada: boolean; podeAlterar: boolean; pedidoRemarcacao: boolean }) {
  const [conf, confirmar, confirmando] = useActionState<AgendaState>(confirmarAction.bind(null, id), {});
  const [canc, cancelar, cancelando] = useActionState<AgendaState>(cancelarAction.bind(null, id), {});
  const [avis, avisar, avisando] = useActionState<AgendaState>(avisarAction.bind(null, id), {});
  return (
    <div className="space-y-3">
      {!confirmada && (
        <form action={confirmar}>
          <button disabled={confirmando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">Confirmar presença</button>
        </form>
      )}
      <Retorno s={conf} />
      {podeAlterar ? (
        <form action={cancelar} onSubmit={(e) => { if (!window.confirm('Cancelar esta consulta?')) e.preventDefault(); }}>
          <button disabled={cancelando} className="min-h-11 rounded border px-4">Cancelar consulta</button>
        </form>
      ) : (
        <>
          <p>Para alterar, fale com sua nutricionista.</p>
          {!pedidoRemarcacao && (
            <form action={avisar}>
              <button disabled={avisando} className="min-h-11 rounded border px-4">Avisar que preciso remarcar</button>
            </form>
          )}
        </>
      )}
      <Retorno s={canc} />
      <Retorno s={avis} />
    </div>
  );
}
