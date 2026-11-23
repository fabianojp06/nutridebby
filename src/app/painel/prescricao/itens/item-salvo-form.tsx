'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { CamposDoItem, chavesDoItem, doItem, novoItem, type ItemNoFormulario, type TipoItem } from '@/app/painel/pacientes/[id]/documentos/[docId]/campos-do-item';
import { Campo } from '@/components/campo';
import { focarPrimeiroErro } from '@/components/focar-primeiro-erro';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_MODELOS, NOME_DO_ITEM_MAX } from '@/modules/documentos/modelos-textos';
import { TIPOS_ITEM, type ItemPrescricao } from '@/modules/documentos/prescricao';
import type { ItemSalvoState } from './actions';

const M = MSG_MODELOS;

/** O item digitado volta do servidor como o JSON que o formulário mandou; o que não for um item vira o inicial. */
function itemDoJson(texto: string, inicial: ItemNoFormulario): ItemNoFormulario {
  try {
    const v = JSON.parse(texto) as unknown;
    return v && typeof v === 'object' && typeof (v as { tipo?: unknown }).tipo === 'string' ? (v as ItemNoFormulario) : inicial;
  } catch {
    return inicial;
  }
}

/**
 * Plano 22 (T10b, US-379, RN-393): o item salvo — "Nome do item salvo" e **o mesmo formulário do item da receita**
 * (`CamposDoItem` com o prefixo `item`, as chaves de erro do módulo; sem campo de marca, fabricante ou farmácia). Sem a
 * habilitação, os tipos fitoterápicos formulados ficam desabilitados no seletor (o `CamposDoItem` e o módulo conferem).
 * O aviso "Retire dados do paciente antes de salvar." fica acima dos campos. Depois de um erro, volta com o que foi
 * digitado (`valores`, `key`) e o foco vai ao primeiro erro; a chave que nenhum campo mostra vai ao aviso geral.
 * A página manda o item gravado (`item`) ou o tipo do item novo (`tipoNovo`): a conversão para o estado do formulário
 * (`doItem`/`novoItem`, de um arquivo 'use client') só roda aqui, no cliente.
 */
export function ItemSalvoForm({ acao, nome, item, tipoNovo = 'suplemento', habilitada }: { acao: (s: ItemSalvoState, fd: FormData) => Promise<ItemSalvoState>; nome: string; item?: ItemPrescricao; tipoNovo?: TipoItem; habilitada: boolean }) {
  const [state, action, pendente] = useActionState(acao, {});
  const [inicial] = useState(() => ({ nome, item: item ? doItem(item) : novoItem(tipoNovo) }));
  const valores = state.valores ? { nome: state.valores.nome, item: itemDoJson(state.valores.item, inicial.item) } : inicial;
  const formulario = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.erros && Object.keys(state.erros).length) focarPrimeiroErro(formulario.current);
  }, [state.envio, state.erros]);
  return (
    <form ref={formulario} action={action} noValidate className="space-y-6">
      <Aviso tipo="aviso" papel="nenhum">
        {M.avisoItem}
      </Aviso>
      <Campos key={state.envio ?? 0} inicial={valores} erros={state.erros ?? {}} habilitada={habilitada} />
      <Botao type="submit" disabled={pendente}>
        {M.salvar}
      </Botao>
    </form>
  );
}

function Campos({ inicial, erros, habilitada }: { inicial: { nome: string; item: ItemNoFormulario }; erros: Record<string, string>; habilitada: boolean }) {
  const [item, setItem] = useState<ItemNoFormulario>(inicial.item);
  const mostradas = new Set(['nome', ...chavesDoItem(item, 'item')]);
  const sobras = [...new Set(Object.keys(erros).filter((k) => !mostradas.has(k)).map((k) => erros[k]))];
  return (
    <>
      <Campo id="nome" rotulo={M.nomeDoItem} required maxLength={NOME_DO_ITEM_MAX} defaultValue={inicial.nome} erro={erros.nome} />
      <input type="hidden" name="item" value={JSON.stringify(item)} />
      <fieldset className="space-y-3 rounded-2xl border border-borda p-4">
        <legend className="px-1 font-semibold">{TIPOS_ITEM[item.tipo]}</legend>
        <CamposDoItem item={item} indice={0} prefixo="item" habilitada={habilitada} erros={erros} aoMudar={setItem} />
      </fieldset>
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
