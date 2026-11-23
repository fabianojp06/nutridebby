'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import type { TipoDeLocal } from '@/db/schema';
import { DIAS_SEMANA, DURACOES, ROTULO_TIPO_LOCAL } from '@/modules/agenda/constantes';
import { criarRegraAction, type FormAgendaState } from './actions';

function Selecao({ id, rotulo, erro, opcoes, valor, onChange }: { id: string; rotulo: string; erro?: string; opcoes: [string, string][]; valor?: string; onChange?: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <select id={id} name={id} defaultValue={valor ?? ''} onChange={onChange ? (e) => onChange(e.target.value) : undefined} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined} className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
        <option value="" disabled>Escolha…</option>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}

/** O que o formulário precisa de cada local ativo (sem a sala). */
export type LocalDaRegra = { id: string; nome: string; tipo: TipoDeLocal; principal: boolean };

/**
 * Plano 23 (US-401, RN-410): a regra nova sempre tem local, que vem com o principal; a modalidade é o tipo do local.
 * "Também atender por videoconferência nestes horários" só aparece com um local online ativo e só vale na regra presencial.
 */
export function RegraForm({ locais }: { locais: LocalDaRegra[] }) {
  const [state, action, pendente] = useActionState<FormAgendaState, FormData>(criarRegraAction, {});
  const v = state.erros ? (state.valores ?? {}) : {};
  const e = state.erros ?? {};
  const inicial = v.localId || (locais.find((l) => l.principal) ?? locais[0])?.id || '';
  // só decide se a marca do par aparece; quem marca o valor é o `defaultValue` (o reset do formulário volta ao enviado)
  const [localId, setLocalId] = useState(inicial);
  const temOnline = locais.some((l) => l.tipo === 'online');
  const presencial = locais.find((l) => l.id === localId)?.tipo === 'presencial';
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-5">
      <Selecao id="localId" rotulo="Local" erro={e.localId} valor={inicial} onChange={setLocalId} opcoes={locais.map((l) => [l.id, `${l.nome} (${ROTULO_TIPO_LOCAL[l.tipo]})`])} />
      <Selecao id="diaSemana" rotulo="Dia da semana" erro={e.diaSemana} valor={v.diaSemana} opcoes={DIAS_SEMANA.map((d, i) => [String(i), d])} />
      <Campo id="inicio" rotulo="Início" type="time" required defaultValue={v.inicio} erro={e.inicio} />
      <Campo id="fim" rotulo="Fim" type="time" required defaultValue={v.fim} erro={e.fim} />
      <Selecao id="duracaoMin" rotulo="Duração" erro={e.duracaoMin} valor={v.duracaoMin ?? '60'} opcoes={DURACOES.map((d) => [String(d), `${d} min`])} />
      {temOnline && presencial && (
        <div className="sm:col-span-5">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="checkbox" name="tambemOnline" defaultChecked={v.tambemOnline === 'on'} />
            Também atender por videoconferência nestes horários
          </label>
        </div>
      )}
      <div className="sm:col-span-5">
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        {state.ok && <p role="status">{state.ok}</p>}
        <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Adicionar horário</button>
      </div>
    </form>
  );
}
