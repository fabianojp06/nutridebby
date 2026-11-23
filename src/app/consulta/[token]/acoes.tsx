'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import type { HorarioVisivel, LocalVisivel } from '@/modules/agenda/horarios';
import { avisarAction, cancelarAction, confirmarAction, remarcarAction, type AcaoLinkState } from './actions';

type Props = {
  token: string;
  ativa: boolean;
  confirmada: boolean;
  podeAlterar: boolean;
  pedidoRemarcacao: boolean;
  /** Plano 23 (US-403): os locais com agendamento pelo paciente (sem a sala); a remarcação abre no local da consulta. */
  locais: LocalVisivel[];
  localInicial: string | null;
  semana: { rotulo: string; anterior: string | null; proxima: string | null };
  horarios: HorarioVisivel[];
};

function Retorno({ s }: { s: AcaoLinkState }) {
  if (s.erro) return <p role="alert" className="text-red-700">{s.erro}</p>;
  if (s.ok) return <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p>;
  return null;
}

/**
 * Ações do link da consulta (US-033, US-035). Fica montado mesmo quando a consulta deixa de estar ativa: depois de
 * cancelar ou remarcar, a página se refaz (a consulta do link passa a "cancelada") e o retorno continua na tela.
 */
export function AcoesConsulta({ token, ativa, confirmada, podeAlterar, pedidoRemarcacao, locais, localInicial, semana, horarios }: Props) {
  const [conf, confirmar, confirmando] = useActionState<AcaoLinkState>(confirmarAction.bind(null, token), {});
  const [canc, cancelar, cancelando] = useActionState<AcaoLinkState>(cancelarAction.bind(null, token), {});
  const [avis, avisar, avisando] = useActionState<AcaoLinkState>(avisarAction.bind(null, token), {});
  const [rem, remarcar, remarcando] = useActionState<AcaoLinkState, FormData>(remarcarAction.bind(null, token), {});
  const [local, setLocal] = useState<string | null>(localInicial);
  // a troca de semana leva o local escolhido (`?local=`, só o valor inicial da página seguinte)
  const href = (data: string) => `/consulta/${token}?semana=${data}${local ? `&local=${encodeURIComponent(local)}` : ''}`;
  if (!ativa) {
    return (
      <div className="space-y-3">
        <Retorno s={conf} />
        <Retorno s={rem} />
        <Retorno s={canc} />
        <Retorno s={avis} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {!confirmada && (
        <form action={confirmar}>
          <button disabled={confirmando} className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar presença</button>
        </form>
      )}
      <Retorno s={conf} />
      {podeAlterar ? (
        <>
          <section aria-labelledby="remarcar" className="space-y-3">
            <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
            <nav aria-label="Semana" className="flex gap-3 text-sm">
              {semana.anterior && <Link href={href(semana.anterior)} className="underline">Semana anterior</Link>}
              <span>{semana.rotulo}</span>
              {semana.proxima && <Link href={href(semana.proxima)} className="underline">Próxima semana</Link>}
            </nav>
            <form action={remarcar} className="space-y-3">
              <p className="font-medium">Escolha um novo horário</p>
              <SeletorHorarios horarios={horarios} locais={locais} local={local} aoTrocarLocal={setLocal} erro={rem.erroHorario} />
              <button disabled={remarcando} className="rounded border px-4 py-2">Remarcar para este horário</button>
            </form>
            <Retorno s={rem} />
          </section>
          <form action={cancelar} onSubmit={(e) => { if (!window.confirm('Cancelar esta consulta?')) e.preventDefault(); }}>
            <button disabled={cancelando} className="underline">Cancelar consulta</button>
          </form>
          <Retorno s={canc} />
        </>
      ) : (
        <>
          <p role="status">{MSG_AGENDA.foraDoPrazo}</p>
          {!pedidoRemarcacao && (
            <form action={avisar}>
              <button disabled={avisando} className="underline">Avisar que preciso remarcar</button>
            </form>
          )}
          <Retorno s={avis} />
        </>
      )}
    </div>
  );
}
