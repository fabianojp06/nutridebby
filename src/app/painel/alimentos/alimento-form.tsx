'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import { MSG_NUTRIENTES, NUTRIENTES, UNIDADE_NA_TELA } from '@/modules/alimentos/nutrientes';
import type { AlimentoState } from './actions';
import { nomeDoCampoMicro } from './campos-micros';

/** Os 7 campos principais; os micros (US-231), opcionais, pelo `name` do campo (`micros.<chave>`). */
type Valores = Record<'nome' | 'grupo' | 'kcal' | 'proteinaG' | 'carboidratoG' | 'lipidioG' | 'fibraG', string> & Record<string, string>;

export function AlimentoForm({ acao, inicial, rotuloBotao }: { acao: (s: AlimentoState, fd: FormData) => Promise<AlimentoState>; inicial: Valores; rotuloBotao: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  const v: Valores = { ...inicial, ...state.valores };
  const numero = (id: keyof Valores, rotulo: string) => <Campo id={id} rotulo={rotulo} inputMode="decimal" defaultValue={v[id]} erro={e[id]} />;
  // a seção abre sozinha com micro preenchido ou com erro (o erro nunca fica escondido)
  const abrirMicros = NUTRIENTES.some((n) => v[nomeDoCampoMicro(n.chave)] || e[nomeDoCampoMicro(n.chave)]);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Campo id="nome" rotulo="Nome" required defaultValue={v.nome} erro={e.nome} />
      <div className="space-y-1">
        <label htmlFor="grupo" className="block font-medium">Grupo</label>
        {/* key: o React não re-sincroniza o defaultValue de um <select>, e o reset automático do formulário voltaria à opção inicial */}
        <select key={v.grupo} id="grupo" name="grupo" defaultValue={v.grupo} aria-invalid={e.grupo ? true : undefined} aria-describedby={e.grupo ? 'grupo-erro' : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
          <option value="">Escolha…</option>
          {GRUPOS_TACO.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {e.grupo && <p id="grupo-erro" role="alert" className="text-sm text-erro">{e.grupo}</p>}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-5">
        <legend className="mb-1 font-medium">Valores por 100 g</legend>
        {numero('kcal', 'Energia (kcal)')}
        {numero('proteinaG', 'Proteína (g)')}
        {numero('carboidratoG', 'Carboidrato (g)')}
        {numero('lipidioG', 'Lipídio (g)')}
        {numero('fibraG', 'Fibra (g)')}
      </fieldset>
      {/* key: o <details> volta a abrir quando um envio traz erro num micro */}
      <details key={abrirMicros ? 'aberta' : 'fechada'} open={abrirMicros || undefined} className="rounded-2xl border border-borda p-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">{MSG_NUTRIENTES.secao}</summary>
        <fieldset className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <legend className="sr-only">Micronutrientes por 100 g</legend>
          {NUTRIENTES.map((n) => {
            const nome = nomeDoCampoMicro(n.chave);
            return <Campo key={n.chave} id={`micro-${n.chave}`} name={nome} rotulo={`${n.nome} (${UNIDADE_NA_TELA[n.unidade]})`} inputMode="decimal" defaultValue={v[nome] ?? ''} erro={e[nome]} />;
          })}
        </fieldset>
      </details>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{rotuloBotao}</button>
    </form>
  );
}
