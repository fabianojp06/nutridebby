'use client';

import { useActionState, useRef } from 'react';
import { Campo } from '@/components/campo';
import { NUTRIENTES, UNIDADE_NA_TELA } from '@/modules/alimentos/nutrientes';
import { FONTE_REFERENCIA_MAX, MSG_REFERENCIAS, NOME_REFERENCIA_MAX, nomeDoCampoDaReferencia } from '@/modules/alimentos/referencias-constantes';
import { useFocoNoPrimeiroErro } from '../foco-no-erro';
import type { ReferenciaState } from './actions';

type Acao = (s: ReferenciaState, fd: FormData) => Promise<ReferenciaState>;
// os campos ficam na faixa com rolagem da tabela: o contorno do foco vai para dentro, senão é cortado (D25)
const NUMERO = 'w-28 rounded-xl border border-campo bg-cartao p-2 text-texto focus-visible:outline-offset-[-3px]';

/**
 * US-232 (RN-238): nome, fonte (obrigatória) e, por nutriente do catálogo, a meta e/ou o máximo do dia. Os erros ficam
 * ao lado do campo (`role="alert"`, `aria-describedby`); o da linha do nutriente vale para os dois campos dela. Salvar com
 * erro leva o foco ao primeiro campo inválido (ou ao aviso "nenhum nutriente", sem campo ao lado): o botão fica no fim
 * da tabela e o erro de Nome/Fonte, no topo, fora da tela (`useFocoNoPrimeiroErro`, como a lista de substituição).
 */
export function ReferenciaForm({ acao, inicial, rotuloBotao }: { acao: Acao; inicial: Record<string, string>; rotuloBotao: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const e = state.erros ?? {};
  const v: Record<string, string> = { ...inicial, ...state.valores };
  const raiz = useRef<HTMLFormElement>(null);
  useFocoNoPrimeiroErro(raiz, state.erros);
  return (
    <form ref={raiz} action={action} className="space-y-4" noValidate>
      <Campo id="nome" rotulo="Nome" required maxLength={NOME_REFERENCIA_MAX} defaultValue={v.nome ?? ''} erro={e.nome} />
      <Campo id="fonte" rotulo="Fonte" required maxLength={FONTE_REFERENCIA_MAX} defaultValue={v.fonte ?? ''} erro={e.fonte} />
      <fieldset aria-describedby={e.valores ? 'valores-erro' : undefined} className="space-y-2">
        <legend className="font-medium">Metas e máximos do dia</legend>
        {e.valores && <p id="valores-erro" role="alert" data-foco-erro tabIndex={-1} className="text-sm text-erro">{e.valores}</p>}
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th scope="col" className="pr-3 text-left">Nutriente</th>
                <th scope="col" className="pr-3 text-left">Meta</th>
                <th scope="col" className="text-left">Máximo</th>
              </tr>
            </thead>
            <tbody>
              {NUTRIENTES.map((n) => {
                const un = UNIDADE_NA_TELA[n.unidade];
                const erro = e[`valores.${n.chave}`];
                const erroId = `valores-${n.chave}-erro`;
                const campo = (tipo: 'meta' | 'maximo', rotulo: string) => {
                  const nome = nomeDoCampoDaReferencia(tipo, n.chave);
                  const id = `${tipo}-${n.chave}`;
                  return (
                    <td className="py-1 pr-3 align-top">
                      <label htmlFor={id} className="sr-only">{`${rotulo} de ${n.nome} (${un})`}</label>
                      <input id={id} name={nome} inputMode="decimal" defaultValue={v[nome] ?? ''} aria-invalid={erro ? true : undefined} aria-describedby={erro ? erroId : undefined} className={NUMERO} />
                    </td>
                  );
                };
                return (
                  <tr key={n.chave}>
                    <th scope="row" className="py-1 pr-3 text-left align-top font-normal">
                      {n.nome} ({un})
                      {erro && <p id={erroId} role="alert" className="text-sm text-erro">{erro}</p>}
                    </th>
                    {campo('meta', 'Meta')}
                    {campo('maximo', 'Máximo')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status" className="text-ok">{state.ok}</p>}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{rotuloBotao}</button>
    </form>
  );
}

/** US-232: a confirmação diz o que acontece com os planos (D30) antes de excluir. */
export function ExcluirReferencia({ acao }: { acao: (s: ReferenciaState) => Promise<ReferenciaState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(ev) => { if (!window.confirm(MSG_REFERENCIAS.excluir)) ev.preventDefault(); }}>
      <button disabled={pendente} className="inline-flex min-h-11 items-center text-link underline">Excluir</button>
      {state.erros?.geral && <p role="alert" className="text-sm text-erro">{state.erros.geral}</p>}
    </form>
  );
}
