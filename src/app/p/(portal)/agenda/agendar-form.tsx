'use client';
import { useActionState, useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';
import type { AgendaState } from './actions';

export function AgendarForm({ acao, horarios, temOnline, rotulo }: { acao: (s: AgendaState, f: FormData) => Promise<AgendaState>; horarios: HorarioVisivel[]; temOnline: boolean; rotulo: string }) {
  const [s, enviar, enviando] = useActionState<AgendaState, FormData>(acao, {});
  const [mod, setMod] = useState<Modalidade>('presencial');
  return (
    <form action={enviar} className="space-y-3">
      {temOnline ? (
        <fieldset className="space-y-1">
          <legend className="font-medium">Escolha a modalidade</legend>
          {(['presencial', 'online'] as const).map((m) => (
            <label key={m} className="mr-4 inline-flex min-h-11 items-center gap-2">
              <input type="radio" name="modalidade" value={m} checked={mod === m} onChange={() => setMod(m)} /> {m === 'presencial' ? 'Presencial' : 'Online'}
            </label>
          ))}
        </fieldset>
      ) : (
        <input type="hidden" name="modalidade" value="presencial" />
      )}
      <SeletorHorarios horarios={horarios} modalidade={mod} erro={s.erro} />
      {s.ok && <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p>}
      <button disabled={enviando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">{rotulo}</button>
    </form>
  );
}
