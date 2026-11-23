'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { CamposDoItem, chavesDoItem, doItem, novoItem, type ItemNoFormulario } from '@/app/painel/pacientes/[id]/documentos/[docId]/campos-do-item';
import { OrientacoesCampo } from '@/app/painel/pacientes/[id]/documentos/[docId]/orientacoes-campo';
import { Campo } from '@/components/campo';
import { focarPrimeiroErro } from '@/components/focar-primeiro-erro';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_MODELOS, NOME_DO_ITEM_MAX } from '@/modules/documentos/modelos-textos';
import { TIPOS_ITEM, type ItemPrescricao } from '@/modules/documentos/prescricao';
import type { ModeloPrescricaoState } from './actions';

const M = MSG_MODELOS;
type Inicial = { nome: string; itens: ItemNoFormulario[]; orientacoes: string };

/** O conteúdo digitado volta do servidor como o JSON que o formulário mandou; o que não for lista vira a inicial. */
function conteudoDoJson(texto: string, inicial: Inicial): Pick<Inicial, 'itens' | 'orientacoes'> {
  try {
    const v = JSON.parse(texto) as { itens?: unknown; orientacoes?: unknown };
    return { itens: Array.isArray(v.itens) ? (v.itens as ItemNoFormulario[]) : inicial.itens, orientacoes: typeof v.orientacoes === 'string' ? v.orientacoes : inicial.orientacoes };
  } catch {
    return inicial;
  }
}

/**
 * Plano 22 (T10b, US-379, RN-394): o modelo de prescrição — "Nome do modelo", os itens (cada um pelo `CamposDoItem`, o
 * mesmo da receita, com "Remover item {n}" e "Adicionar item", até 20) e as orientações com a marcação mínima
 * (`OrientacoesCampo`, até 2000). **Sem** justificativa de uso; o aviso "Retire dados do paciente antes de salvar. A
 * justificativa de uso não vai para o modelo." fica acima dos campos. Itens e orientações vão num campo só (`conteudo`,
 * JSON). Depois de um erro, volta com o que foi digitado (`valores`, `key`) e o foco vai ao primeiro erro.
 */
export function ModeloPrescricaoForm({ acao, nome, itens, orientacoes, habilitada }: { acao: (s: ModeloPrescricaoState, fd: FormData) => Promise<ModeloPrescricaoState>; nome: string; itens: ItemPrescricao[]; orientacoes: string; habilitada: boolean }) {
  const [state, action, pendente] = useActionState(acao, {});
  const [inicial] = useState<Inicial>(() => ({ nome, itens: itens.map(doItem), orientacoes }));
  const valores: Inicial = state.valores ? { nome: state.valores.nome, ...conteudoDoJson(state.valores.conteudo, inicial) } : inicial;
  const formulario = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.erros && Object.keys(state.erros).length) focarPrimeiroErro(formulario.current);
  }, [state.envio, state.erros]);
  return (
    <form ref={formulario} action={action} noValidate className="space-y-6">
      <Aviso tipo="aviso" papel="nenhum">
        {M.avisoModelo}
      </Aviso>
      <Campos key={state.envio ?? 0} inicial={valores} erros={state.erros ?? {}} habilitada={habilitada} />
      <Botao type="submit" disabled={pendente}>
        {M.salvar}
      </Botao>
    </form>
  );
}

function Campos({ inicial, erros, habilitada }: { inicial: Inicial; erros: Record<string, string>; habilitada: boolean }) {
  const [itens, setItens] = useState<ItemNoFormulario[]>(inicial.itens);
  const [orientacoes, setOrientacoes] = useState(inicial.orientacoes);
  const titulo = useRef<HTMLHeadingElement>(null);
  const mostradas = new Set(['nome', 'itens', 'orientacoes']);
  itens.forEach((it, i) => chavesDoItem(it, `itens.${i}`).forEach((k) => mostradas.add(k)));
  const sobras = [...new Set(Object.keys(erros).filter((k) => !mostradas.has(k)).map((k) => erros[k]))];
  return (
    <>
      <Campo id="nome" rotulo={M.nomeDoModelo} required maxLength={NOME_DO_ITEM_MAX} defaultValue={inicial.nome} erro={erros.nome} />
      <input type="hidden" name="conteudo" value={JSON.stringify({ itens, orientacoes })} />
      <section aria-labelledby="itens-do-modelo" className="space-y-4">
        {/* tabIndex -1: o foco vem para cá depois de "Remover item" (o botão sai da lista) */}
        <h2 ref={titulo} id="itens-do-modelo" tabIndex={-1} className="font-titulo text-lg font-semibold">
          {`Itens (${M.itensN(itens.length)})`}
        </h2>
        {erros.itens && (
          <p role="alert" tabIndex={-1} className="text-erro">
            {erros.itens}
          </p>
        )}
        {itens.map((it, i) => (
          <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
            <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
            <CamposDoItem item={it} indice={i} habilitada={habilitada} erros={erros} aoMudar={(novo) => setItens((xs) => xs.map((x, j) => (j === i ? novo : x)))} />
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                setItens((xs) => xs.filter((_, j) => j !== i));
                titulo.current?.focus();
              }}
            >{`Remover item ${i + 1}`}</button>
          </fieldset>
        ))}
        {itens.length < 20 && (
          <Botao type="button" variante="secundario" onClick={() => setItens((xs) => [...xs, novoItem('suplemento')])}>
            Adicionar item
          </Botao>
        )}
      </section>
      <OrientacoesCampo id="orientacoes" rotulo="Orientações gerais (opcional)" max={2000} valor={orientacoes} aoMudar={setOrientacoes} erro={erros.orientacoes} />
      {sobras.length > 0 && (
        <div role="alert" tabIndex={-1} className="space-y-1 text-erro">
          {sobras.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
    </>
  );
}
