'use client';

import { useActionState } from 'react';
import type { AtendimentoState } from './actions';

type Props = {
  acao: (prev: AtendimentoState, formData: FormData) => Promise<AtendimentoState>;
  inicial: { data: string; notasPrivadas: string; orientacoes: string };
  hoje: string;
  botao: string;
  somenteLeitura: boolean;
};

export function AtendimentoForm({ acao, inicial, hoje, botao, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<AtendimentoState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const aria = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{e[k]}</p>;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={somenteLeitura} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="data" className="block font-medium">Data do atendimento</label>
          <input id="data" name="data" type="date" max={hoje} defaultValue={v.data} className="rounded border p-2" {...aria('data')} />
          {erro('data')}
        </div>
        <div className="space-y-1">
          <label htmlFor="notasPrivadas" className="block font-medium">Notas privadas</label>
          <p id="notasPrivadas-dica" className="text-sm text-zinc-700">Só você vê. O paciente nunca vê estas notas.</p>
          <textarea id="notasPrivadas" name="notasPrivadas" rows={6} maxLength={20000} defaultValue={v.notasPrivadas} className="w-full rounded border p-2"
            aria-invalid={e.notasPrivadas ? true : undefined} aria-describedby={e.notasPrivadas ? 'notasPrivadas-dica notasPrivadas-erro' : 'notasPrivadas-dica'} />
          {erro('notasPrivadas')}
        </div>
        <div className="space-y-1">
          <label htmlFor="orientacoes" className="block font-medium">Orientações ao paciente</label>
          <p id="orientacoes-dica" className="text-sm text-zinc-700">O paciente vê estas orientações no portal.</p>
          <textarea id="orientacoes" name="orientacoes" rows={4} maxLength={5000} defaultValue={v.orientacoes} className="w-full rounded border p-2"
            aria-invalid={e.orientacoes ? true : undefined} aria-describedby={e.orientacoes ? 'orientacoes-dica orientacoes-erro' : 'orientacoes-dica'} />
          {erro('orientacoes')}
        </div>
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      {state.ok && <p role="status">Atendimento salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}
