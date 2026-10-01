'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import type { AlimentoState } from './actions';

type Valores = Record<'nome' | 'grupo' | 'kcal' | 'proteinaG' | 'carboidratoG' | 'lipidioG' | 'fibraG', string>;

export function AlimentoForm({ acao, inicial, rotuloBotao }: { acao: (s: AlimentoState, fd: FormData) => Promise<AlimentoState>; inicial: Valores; rotuloBotao: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  const v = { ...inicial, ...state.valores };
  const numero = (id: keyof Valores, rotulo: string) => <Campo id={id} rotulo={rotulo} inputMode="decimal" defaultValue={v[id]} erro={e[id]} />;
  return (
    <form action={action} className="space-y-4" noValidate>
      <Campo id="nome" rotulo="Nome" required defaultValue={v.nome} erro={e.nome} />
      <div className="space-y-1">
        <label htmlFor="grupo" className="block font-medium">Grupo</label>
        {/* key: o React não re-sincroniza o defaultValue de um <select>, e o reset automático do formulário voltaria à opção inicial */}
        <select key={v.grupo} id="grupo" name="grupo" defaultValue={v.grupo} aria-invalid={e.grupo ? true : undefined} aria-describedby={e.grupo ? 'grupo-erro' : undefined} className="w-full rounded border p-2">
          <option value="">Escolha…</option>
          {GRUPOS_TACO.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {e.grupo && <p id="grupo-erro" role="alert" className="text-sm text-red-700">{e.grupo}</p>}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-5">
        <legend className="mb-1 font-medium">Valores por 100 g</legend>
        {numero('kcal', 'Energia (kcal)')}
        {numero('proteinaG', 'Proteína (g)')}
        {numero('carboidratoG', 'Carboidrato (g)')}
        {numero('lipidioG', 'Lipídio (g)')}
        {numero('fibraG', 'Fibra (g)')}
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{rotuloBotao}</button>
    </form>
  );
}
