'use client';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import type { HorarioVisivel, LocalVisivel } from '@/modules/agenda/horarios';
import type { AgendaState } from './actions';

/** A navegação entre semanas: `base` é a página (sem query); a semana e o local escolhido vão na URL. */
export type SemanaDoForm = { base: string; rotulo: string; anterior: string | null; proxima: string | null };

/**
 * Agendar e remarcar no portal. Plano 23 (US-403, I-13): a escolha do local (com mais de um) filtra os horários aqui mesmo;
 * `localInicial` é o `?local=` ou, na remarcação, o local da consulta. A troca de semana leva o local escolhido. Nunca a sala.
 */
export function AgendarForm({ acao, horarios, locais, localInicial, rotulo, semana }: { acao: (s: AgendaState, f: FormData) => Promise<AgendaState>; horarios: HorarioVisivel[]; locais: LocalVisivel[]; localInicial: string | null; rotulo: string; semana: SemanaDoForm }) {
  const [s, enviar, enviando] = useActionState<AgendaState, FormData>(acao, {});
  const [local, setLocal] = useState<string | null>(localInicial);
  const href = (data: string) => `${semana.base}?semana=${data}${local ? `&local=${encodeURIComponent(local)}` : ''}`;
  return (
    <div className="space-y-3">
      <nav aria-label="Semana" className="flex items-center gap-3 text-sm">
        {semana.anterior && <Link href={href(semana.anterior)} className="inline-flex min-h-11 items-center underline">Semana anterior</Link>}
        <span>{semana.rotulo}</span>
        {semana.proxima && <Link href={href(semana.proxima)} className="inline-flex min-h-11 items-center underline">Próxima semana</Link>}
      </nav>
      <form action={enviar} className="space-y-3">
        <SeletorHorarios horarios={horarios} locais={locais} local={local} aoTrocarLocal={setLocal} erro={s.erro} />
        {s.ok && <p role="status" className="rounded bg-ok-fundo p-3">{s.ok}</p>}
        <button disabled={enviando} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">{rotulo}</button>
      </form>
    </div>
  );
}
