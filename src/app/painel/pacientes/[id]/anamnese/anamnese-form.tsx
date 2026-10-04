'use client';

import { useActionState } from 'react';
import type { Pergunta } from '@/modules/pacientes/anamnese-tipos';
import type { AnamneseState } from './actions';

type Props = {
  acao: (prev: AnamneseState, formData: FormData) => Promise<AnamneseState>;
  perguntas: Pergunta[];
  inicial: Record<string, string | string[]>;
  botao: string;
  somenteLeitura: boolean;
};

export function AnamneseForm({ acao, perguntas, inicial, botao, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<AnamneseState, FormData>(acao, {});
  const valores = state.valores ?? inicial;
  const erros = state.erros ?? {};
  // O modelo pode ter ganhado uma pergunta obrigatória depois que a tela abriu: o erro dela não tem campo aqui
  const naTela = new Set(perguntas.map((p) => p.id));
  const semCampo = Object.entries(erros).filter(([k]) => k !== 'geral' && !naTela.has(k)).map(([, v]) => v);
  return (
    <form action={action} className="space-y-4">
      <fieldset key={state.envio ?? 0} disabled={somenteLeitura} className="space-y-4">
        {perguntas.map((p) => (
          <Campo key={p.id} p={p} valor={valores[p.id] ?? (p.tipo === 'multipla_escolha' ? [] : '')} erro={erros[p.id]} />
        ))}
      </fieldset>
      {erros.geral && <p role="alert" className="text-erro">{erros.geral}</p>}
      {semCampo.length > 0 && (
        <p role="alert" className="text-erro">{`O modelo mudou enquanto você preenchia. Recarregue a página. (${semCampo.join(' · ')})`}</p>
      )}
      {state.ok && <p role="status">Anamnese salva.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}

function Campo({ p, valor, erro }: { p: Pergunta; valor: string | string[]; erro?: string }) {
  const nome = `r_${p.id}`;
  const rotulo = `${p.rotulo}${p.tipo === 'numero' && p.unidade ? ` (${p.unidade})` : ''}${p.obrigatoria ? ' (obrigatória)' : ''}`;
  const aria = erro ? { 'aria-invalid': true as const, 'aria-describedby': `${nome}-erro` } : {};
  const mensagem = erro && <p id={`${nome}-erro`} role="alert" className="text-sm text-erro">{erro}</p>;
  const texto = typeof valor === 'string' ? valor : '';
  if (p.tipo === 'sim_nao' || p.tipo === 'escolha_unica' || p.tipo === 'multipla_escolha') {
    const opcoes = p.tipo === 'sim_nao' ? [['sim', 'Sim'], ['nao', 'Não']] : (p.opcoes ?? []).map((o) => [o, o]);
    const multipla = p.tipo === 'multipla_escolha';
    return (
      <fieldset className="space-y-1" {...(erro ? { 'aria-describedby': `${nome}-erro` } : {})}>
        <legend className="font-medium">{rotulo}</legend>
        {opcoes.map(([v, r], i) => (
          <div key={v} className="flex items-center gap-2">
            <input id={`${nome}-${i}`} name={nome} type={multipla ? 'checkbox' : 'radio'} value={v}
              defaultChecked={multipla ? (valor as string[]).includes(v) : texto === v} aria-invalid={erro ? true : undefined} />
            <label htmlFor={`${nome}-${i}`}>{r}</label>
          </div>
        ))}
        {mensagem}
      </fieldset>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={nome} className="block font-medium">{rotulo}</label>
      {p.tipo === 'texto_longo' ? (
        <textarea id={nome} name={nome} defaultValue={texto} rows={3} maxLength={5000} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria} />
      ) : (
        <input id={nome} name={nome} defaultValue={texto} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria}
          {...(p.tipo === 'data' ? { type: 'date' } : p.tipo === 'numero' ? { inputMode: 'decimal' as const } : { maxLength: 200 })} />
      )}
      {mensagem}
    </div>
  );
}
