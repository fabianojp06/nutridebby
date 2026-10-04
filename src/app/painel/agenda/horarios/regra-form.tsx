'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { DIAS_SEMANA, DURACOES, ROTULO_MODALIDADE_REGRA } from '@/modules/agenda/constantes';
import { criarRegraAction, type FormAgendaState } from './actions';

function Selecao({ id, rotulo, erro, opcoes, valor }: { id: string; rotulo: string; erro?: string; opcoes: [string, string][]; valor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <select id={id} name={id} defaultValue={valor ?? ''} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
        <option value="" disabled>Escolha…</option>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}

export function RegraForm() {
  const [state, action, pendente] = useActionState<FormAgendaState, FormData>(criarRegraAction, {});
  const v = state.erros ? (state.valores ?? {}) : {};
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-5">
      <Selecao id="diaSemana" rotulo="Dia da semana" erro={e.diaSemana} valor={v.diaSemana} opcoes={DIAS_SEMANA.map((d, i) => [String(i), d])} />
      <Campo id="inicio" rotulo="Início" type="time" required defaultValue={v.inicio} erro={e.inicio} />
      <Campo id="fim" rotulo="Fim" type="time" required defaultValue={v.fim} erro={e.fim} />
      <Selecao id="duracaoMin" rotulo="Duração" erro={e.duracaoMin} valor={v.duracaoMin ?? '60'} opcoes={DURACOES.map((d) => [String(d), `${d} min`])} />
      <Selecao id="modalidade" rotulo="Modalidade" erro={e.modalidade} valor={v.modalidade ?? 'presencial'} opcoes={Object.entries(ROTULO_MODALIDADE_REGRA)} />
      <div className="sm:col-span-5">
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        {state.ok && <p role="status">{state.ok}</p>}
        <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">Adicionar horário</button>
      </div>
    </form>
  );
}
