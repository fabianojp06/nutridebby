'use client';

import { useActionState, useId, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { semResetAutomatico } from '@/lib/form-sem-reset';
import type { NomeParaComecar } from '@/modules/exames/catalogo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { adicionarNomesParaComecarAction, type NomesParaComecarState } from './actions';

const C = MSG_EXAMES.catalogo;

/**
 * Plano 22 (T3, US-370 "Catálogo vazio", RN-372): o botão "Nomes de exames para começar" (fica enquanto houver nome da
 * lista fora do catálogo) e o `Dialogo` com a lista — nada marcado, "Selecionar todos" e "Adicionar ao catálogo". O
 * `<form>` fica dentro do diálogo. Depois de adicionar, a action volta à lista com um marcador novo (`marcador`): o
 * diálogo fecha sozinho (o aberto vale só para o marcador em que foi aberto) e o corpo dele é montado de novo (`key`),
 * sem as marcas; o foco volta ao botão — ou, se a lista acabou e o botão saiu, ao título da tela (`idTitulo`). As caixas
 * são controladas e o reset automático do React 19 fica cancelado (`semResetAutomatico`, SUS-108): no erro (mesmo
 * marcador, sem remontagem) o `form.reset()` desmarcava as caixas com o estado ainda marcado.
 */
export function NomesParaComecar({ faltando, marcador, idTitulo }: { faltando: Pick<NomeParaComecar, 'nome' | 'componentes'>[]; marcador: string; idTitulo: string }) {
  const [abertoEm, setAbertoEm] = useState<string | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" data-guia="nomes-para-comecar" onClick={() => setAbertoEm(marcador)}>
        {C.comecar}
      </Botao>
      <ListaDeNomes key={marcador} aberto={abertoEm === marcador} aoFechar={() => setAbertoEm(null)} faltando={faltando} idTitulo={idTitulo} />
    </>
  );
}

function ListaDeNomes({ aberto, aoFechar, faltando, idTitulo }: { aberto: boolean; aoFechar: () => void; faltando: Pick<NomeParaComecar, 'nome' | 'componentes'>[]; idTitulo: string }) {
  const [state, action, pendente] = useActionState<NomesParaComecarState, FormData>(adicionarNomesParaComecarAction, {});
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  const idForm = `${id}-form`;
  const idErro = `${id}-erro`;
  const alternar = (nome: string) =>
    setMarcados((m) => {
      const novo = new Set(m);
      if (novo.has(nome)) novo.delete(nome);
      else novo.add(nome);
      return novo;
    });
  return (
    <Dialogo
      aberto={aberto}
      titulo={C.tituloDialogoComecar}
      descricao={C.ajudaComecar}
      aoFechar={aoFechar}
      ocupado={pendente}
      focoAoFechar={() => document.getElementById(idTitulo)}
      rodape={
        <>
          <Botao type="button" variante="secundario" onClick={() => !pendente && aoFechar()} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60">
            {MSG_EXAMES.erros.cancelar}
          </Botao>
          <Botao type="submit" form={idForm} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60">
            {C.adicionar}
          </Botao>
        </>
      }
    >
      <form
        id={idForm}
        ref={semResetAutomatico}
        action={action}
        onSubmit={(e) => {
          if (pendente) e.preventDefault();
        }}
        aria-describedby={state.erro ? idErro : undefined}
        className="space-y-3"
      >
        <Botao type="button" variante="secundario" onClick={() => setMarcados(new Set(faltando.map((n) => n.nome)))}>
          {C.selecionarTodos}
        </Botao>
        <ul className="space-y-1">
          {faltando.map((n) => (
            <li key={n.nome}>
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="nome" value={n.nome} checked={marcados.has(n.nome)} onChange={() => alternar(n.nome)} className="size-5" />
                <span>
                  {n.nome}
                  {n.componentes.length > 0 && <span className="text-suave"> · {C.painel(n.componentes.length)}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {state.erro && (
          <p key={state.envio} id={idErro} role="alert" className="text-erro">
            {state.erro}
          </p>
        )}
      </form>
    </Dialogo>
  );
}
