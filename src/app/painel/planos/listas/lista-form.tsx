'use client';

import { useActionState, useRef, useState } from 'react';
import { BuscaAlimento } from '@/app/painel/alimentos/busca-alimento';
import { MSG_TEXTO_LIVRE } from '@/modules/plano-alimentar/constantes';
import {
  MAX_GRUPOS_LISTA, MAX_ITENS_GRUPO, MSG_LISTAS, NOME_GRUPO_MAX, NOME_LISTA_MAX, ORIENTACAO_LISTA_MAX, type ListaEnviada,
} from '@/modules/plano-alimentar/biblioteca-constantes';
import type { Lista } from '@/modules/plano-alimentar/listas';
import { DialogoBuscaAlimento, type DestinoDaBusca } from '../editor/dialogo-busca';
import { itemDoAlimento, itemEstadoDe, itemParaEnvio, referenciaDosEquivalentes, type ItemEstado } from '../editor/estado';
import { useFocoNoPrimeiroErro } from '../foco-no-erro';
import { ItemDaBiblioteca } from '../item-da-biblioteca';
import type { ListaState } from './actions';

type Acao = (s: ListaState, fd: FormData) => Promise<ListaState>;
type GrupoEstado = { id: string; nome: string; itens: ItemEstado[] };

const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50';
const LINK = 'inline-flex min-h-11 items-center text-sm underline disabled:opacity-50';
const descritoPor = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;
const novoId = () => crypto.randomUUID(); // gerado no evento, nunca no render

/**
 * US-238 (RN-251): nome, orientação ("Aparece para o paciente no app.", RN-254) e os grupos, cada um com os alimentos
 * (busca por nome, quantidade e medida caseira, energia calculada agora) e "Sugerir equivalentes", que abre o diálogo de
 * busca na aba Equivalentes com o primeiro item do grupo como referência (RN-242): o escolhido entra no grupo com a
 * quantidade sugerida. Tudo vai num JSON (`dados`); os erros ficam ao lado do campo e, a cada resposta com erro, o foco
 * vai ao primeiro campo inválido (a página é longa: o botão "Salvar lista" fica no fim).
 */
export function ListaForm({ acao, lista, rotuloBotao }: { acao: Acao; lista: Lista | null; rotuloBotao: string }) {
  const [state, action, pendente] = useActionState(acao, {});
  const [nome, setNome] = useState(lista?.nome ?? '');
  const [orientacao, setOrientacao] = useState(lista?.orientacao ?? '');
  const [grupos, setGrupos] = useState<GrupoEstado[]>(() => (lista?.grupos ?? []).map((g) => ({ id: g.id, nome: g.nome, itens: g.itens.map(itemEstadoDe) })));
  const [busca, setBusca] = useState<{ destino: DestinoDaBusca; n: number } | null>(null);
  const abridor = useRef<HTMLElement | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  useFocoNoPrimeiroErro(raiz, state.erros);
  const e = state.erros ?? {};
  const erro = (k: string) => e[k];
  const dados: ListaEnviada = { nome, orientacao, grupos: grupos.map((g) => ({ id: g.id, nome: g.nome, itens: g.itens.map(itemParaEnvio) })) };

  const noGrupo = (id: string, f: (g: GrupoEstado) => GrupoEstado) => setGrupos((gs) => gs.map((g) => (g.id === id ? f(g) : g)));
  const nomeDoGrupo = (g: GrupoEstado, k: number) => g.nome.trim() || `Grupo ${k + 1}`;
  const grupoDaBusca = busca ? grupos.find((g) => g.id === busca.destino.refeicaoId) : undefined;

  return (
    <div ref={raiz} className="space-y-4">
      {/* só o JSON e o botão ficam no formulário: Enter na busca de alimento (fora dele) não envia a lista */}
      <form id="lista-form" action={action} noValidate>
        <input type="hidden" name="dados" value={JSON.stringify(dados)} />
      </form>
      <div className="space-y-1">
        <label htmlFor="nome" className="block font-medium">Nome</label>
        <input id="nome" value={nome} maxLength={NOME_LISTA_MAX} onChange={(ev) => setNome(ev.target.value)} aria-invalid={e.nome ? true : undefined} aria-describedby={e.nome ? 'nome-erro' : undefined} className={CAMPO} />
        {e.nome && <p id="nome-erro" role="alert" className="text-sm text-erro">{e.nome}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="orientacao" className="block font-medium">Orientação</label>
        <p id="orientacao-dica" className="text-sm text-suave">{MSG_TEXTO_LIVRE.apareceNoApp}</p>
        <textarea
          id="orientacao"
          rows={3}
          maxLength={ORIENTACAO_LISTA_MAX}
          value={orientacao}
          onChange={(ev) => setOrientacao(ev.target.value)}
          aria-invalid={e.orientacao ? true : undefined}
          aria-describedby={descritoPor('orientacao-dica', e.orientacao && 'orientacao-erro')}
          className={CAMPO}
        />
        {e.orientacao && <p id="orientacao-erro" role="alert" className="text-sm text-erro">{e.orientacao}</p>}
      </div>

      {grupos.map((g, k) => {
        const rotulo = nomeDoGrupo(g, k);
        const primeiro = g.itens[0];
        const referencia = primeiro ? referenciaDosEquivalentes(primeiro) : null;
        const cabe = g.itens.length < MAX_ITENS_GRUPO;
        const erroNome = e[`grupo:${g.id}:nome`];
        const erroItens = e[`grupo:${g.id}:itens`];
        return (
          <section key={g.id} aria-labelledby={`${g.id}-titulo`} className="space-y-3 rounded-2xl border border-borda bg-cartao p-3">
            <h2 id={`${g.id}-titulo`} className="sr-only">{rotulo}</h2>
            <div className="space-y-1">
              <label htmlFor={`${g.id}-nome`} className="block font-medium">Nome do grupo {k + 1}</label>
              <input
                id={`${g.id}-nome`}
                value={g.nome}
                maxLength={NOME_GRUPO_MAX}
                onChange={(ev) => noGrupo(g.id, (x) => ({ ...x, nome: ev.target.value }))}
                aria-invalid={erroNome ? true : undefined}
                aria-describedby={erroNome ? `${g.id}-nome-erro` : undefined}
                className={CAMPO}
              />
              {erroNome && <p id={`${g.id}-nome-erro`} role="alert" className="text-sm text-erro">{erroNome}</p>}
            </div>
            <ul className="space-y-2">
              {g.itens.map((i) => (
                <ItemDaBiblioteca
                  key={i.id}
                  i={i}
                  onde={rotulo}
                  alterar={(novo) => noGrupo(g.id, (x) => ({ ...x, itens: x.itens.map((y) => (y.id === i.id ? novo : y)) }))}
                  remover={() => noGrupo(g.id, (x) => ({ ...x, itens: x.itens.filter((y) => y.id !== i.id) }))}
                  erro={erro}
                />
              ))}
            </ul>
            {erroItens && <p role="alert" tabIndex={-1} data-foco-erro className="text-sm text-erro">{erroItens}</p>}
            {cabe ? (
              <BuscaAlimento rotulo={`Adicionar alimento em ${rotulo}`} aoEscolher={(a) => noGrupo(g.id, (x) => ({ ...x, itens: [...x.itens, itemDoAlimento(a, novoId())] }))} />
            ) : (
              <p id={`${g.id}-limite`} className="text-sm text-suave">{MSG_LISTAS.limite}</p>
            )}
            <div className="flex flex-wrap gap-4">
              {/* RN-251: o primeiro item do grupo é a referência (RN-242); sem item (ou com a quantidade em erro), desabilitado */}
              <button
                type="button"
                disabled={!referencia || !cabe}
                aria-describedby={!cabe ? `${g.id}-limite` : undefined}
                onClick={(ev) => {
                  if (!referencia || !primeiro) return;
                  abridor.current = ev.currentTarget;
                  setBusca((b) => ({ destino: { refeicaoId: g.id, refeicao: rotulo, aba: 'equivalentes', referencia: { itemId: primeiro.id, nomeItem: primeiro.nome, ...referencia } }, n: (b?.n ?? 0) + 1 }));
                }}
                className={LINK}
              >
                {MSG_LISTAS.sugerir}<span className="sr-only"> em {rotulo}</span>
              </button>
              <button type="button" onClick={() => setGrupos((gs) => gs.filter((x) => x.id !== g.id))} className={LINK}>
                Remover grupo<span className="sr-only"> {rotulo}</span>
              </button>
            </div>
          </section>
        );
      })}

      {busca && grupoDaBusca && (
        <DialogoBuscaAlimento
          key={busca.n}
          destino={busca.destino}
          podeAdicionar={grupoDaBusca.itens.length < MAX_ITENS_GRUPO}
          limite={MSG_LISTAS.limite}
          equivalenteComoItem
          aoAdicionar={(a, o) => noGrupo(grupoDaBusca.id, (x) => (x.itens.length < MAX_ITENS_GRUPO ? { ...x, itens: [...x.itens, itemDoAlimento(a, novoId(), { quantidadeG: o?.quantidadeG })] } : x))}
          aoFechar={() => {
            setBusca(null);
            abridor.current?.focus();
          }}
        />
      )}

      <div className="space-y-1">
        <button
          type="button"
          disabled={grupos.length >= MAX_GRUPOS_LISTA}
          aria-describedby={grupos.length >= MAX_GRUPOS_LISTA ? 'limite-grupos' : undefined}
          onClick={() => setGrupos((gs) => (gs.length < MAX_GRUPOS_LISTA ? [...gs, { id: novoId(), nome: '', itens: [] }] : gs))}
          className={BOTAO}
        >
          {MSG_LISTAS.adicionarGrupo}
        </button>
        {grupos.length >= MAX_GRUPOS_LISTA && <p id="limite-grupos" className="text-sm text-suave">{MSG_LISTAS.limite}</p>}
      </div>

      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status" className="text-ok">{state.ok}</p>}
      <button form="lista-form" disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{rotuloBotao}</button>
    </div>
  );
}

/** Excluir com a confirmação (as cópias ligadas aos planos não mudam, RN-252). */
export function ExcluirLista({ acao }: { acao: (s: ListaState) => Promise<ListaState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(ev) => { if (!window.confirm(MSG_LISTAS.excluir)) ev.preventDefault(); }}>
      <button disabled={pendente} className="inline-flex min-h-11 items-center text-link underline">Excluir</button>
      {state.erros?.geral && <p role="alert" className="text-sm text-erro">{state.erros.geral}</p>}
    </form>
  );
}
