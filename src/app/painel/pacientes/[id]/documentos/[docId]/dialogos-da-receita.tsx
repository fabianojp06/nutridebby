'use client';

import Link from 'next/link';
import { useActionState, useId, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { Campo } from '@/components/campo';
import { Dialogo, DialogoConfirmar } from '@/components/dialogo';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_MODELOS, NOME_DO_ITEM_MAX, TIPOS_DO_GRUPO, type GrupoDeItens } from '@/modules/documentos/modelos-textos';
import { exigeHabilitacao, MSG_PRESCRICAO, TIPOS_ITEM, type ConteudoReceita, type ItemPrescricao } from '@/modules/documentos/prescricao';
import type { EstadoBiblioteca, EstadoForm } from '../actions';

const M = MSG_MODELOS;

/** Um item salvo como o diálogo "Adicionar item salvo" o recebe (a cópia vai para a receita, sem FK). */
export type ItemSalvoDaReceita = { id: string; nome: string; tipo: string; item: ItemPrescricao };
/** Um modelo de prescrição no diálogo "Carregar modelo": nome e quantos itens (os itens ficam no servidor). */
export type ModeloDaReceita = { id: string; nome: string; itens: number };

/**
 * O contêiner do tema mais próximo do botão: o diálogo vai para fora do `<form>` da receita no DOM (`createPortal`), com
 * os tokens de cor — contrato do `Dialogo` (nunca dentro de `<form>` da tela), como `EscolherDoCatalogo` (T3) e o
 * "Carregar modelo" da solicitação (T8). Assim o `<form>` do diálogo não fica aninhado e o `Enter` no nome não envia a receita.
 */
const destinoDe = (el: HTMLElement) => el.closest<HTMLElement>('[data-tema]') ?? document.body;
const mensagens = (erros: Record<string, string> | undefined, fora: string[] = []) => [...new Set(Object.entries(erros ?? {}).filter(([k]) => !fora.includes(k)).map(([, v]) => v))];

/**
 * "Salvar item" e "Salvar como modelo" (US-379, RN-394): o nome num `<form>` próprio dentro do `Dialogo`, com o aviso de
 * tirar os dados do paciente. Nenhum dos dois salva o rascunho. Deu certo: fecha (o foco volta ao botão que abriu) e a
 * receita anuncia a mensagem na região de status. Os erros do item ou dos itens (que estão nos campos da receita, fora
 * do diálogo) aparecem aqui, como lista; o do nome, no campo.
 */
function DialogoDoNome({
  destino,
  titulo,
  rotulo,
  aviso,
  botao,
  acao,
  campos,
  aoFechar,
  aoSalvo,
}: {
  destino: HTMLElement;
  titulo: string;
  rotulo: string;
  aviso: string;
  botao: string;
  acao: (prev: EstadoBiblioteca, f: FormData) => Promise<EstadoBiblioteca>;
  campos: Record<string, string>;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const [s, action, pendente] = useActionState<EstadoBiblioteca, FormData>(async (prev, f) => {
    const r = await acao(prev, f);
    if (r.ok) aoSalvo();
    return r;
  }, {});
  const id = useId();
  const outros = mensagens(s.erros, ['nome']);
  const desligado = pendente || undefined;
  return createPortal(
    <Dialogo aberto titulo={titulo} aoFechar={aoFechar} ocupado={pendente} rodape={null}>
      <form
        action={action}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          if (pendente) e.preventDefault(); // um envio por vez (o botão fica aria-disabled, sem disabled, para o foco ficar no diálogo)
        }}
      >
        <Aviso tipo="aviso" papel="nenhum">
          {aviso}
        </Aviso>
        <Campo key={s.envio ?? 0} id={`${id}-nome`} name="nome" rotulo={rotulo} required maxLength={NOME_DO_ITEM_MAX} defaultValue={s.valores?.nome ?? ''} erro={s.erros?.nome} data-foco-inicial="" />
        {Object.entries(campos).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {outros.length > 0 && (
          <div role="alert" className="space-y-1 text-erro">
            {outros.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Botao type="button" variante="secundario" onClick={() => !pendente && aoFechar()} aria-disabled={desligado} className="aria-disabled:opacity-60">
            {M.cancelar}
          </Botao>
          <Botao type="submit" aria-disabled={desligado} className="aria-disabled:opacity-60">
            {botao}
          </Botao>
        </div>
      </form>
    </Dialogo>,
    destino,
  );
}

/** US-379 "Salvar item" de um item do rascunho (o nome acessível leva o número do item). */
export function SalvarItem({ numero, item, acao, aoSalvo }: { numero: number; item: unknown; acao: (prev: EstadoBiblioteca, f: FormData) => Promise<EstadoBiblioteca>; aoSalvo: (mensagem: string) => void }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" aria-label={M.salvarItemRotulo(numero)} onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {M.salvarItem}
      </Botao>
      {destino && (
        <DialogoDoNome
          destino={destino}
          titulo={M.salvarItem}
          rotulo={M.nomeDoItem}
          aviso={M.avisoItem}
          botao={M.salvarItem}
          acao={acao}
          campos={{ item: JSON.stringify(item) }}
          aoFechar={() => setDestino(null)}
          aoSalvo={() => {
            setDestino(null);
            aoSalvo(M.itemSalvo);
          }}
        />
      )}
    </>
  );
}

/** US-379 "Salvar como modelo": os itens e as orientações da tela; a justificativa de uso não vai (RN-394). */
export function SalvarComoModelo({ conteudo, acao, aoSalvo }: { conteudo: { itens: unknown[]; orientacoes: string }; acao: (prev: EstadoBiblioteca, f: FormData) => Promise<EstadoBiblioteca>; aoSalvo: (mensagem: string) => void }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {M.salvarComoModelo}
      </Botao>
      {destino && (
        <DialogoDoNome
          destino={destino}
          titulo={M.salvarComoModelo}
          rotulo={M.nomeDoModelo}
          aviso={M.avisoModelo}
          botao={M.salvarComoModelo}
          acao={acao}
          campos={{ conteudo: JSON.stringify(conteudo) }}
          aoFechar={() => setDestino(null)}
          aoSalvo={() => {
            setDestino(null);
            aoSalvo(M.modeloSalvo);
          }}
        />
      )}
    </>
  );
}

/**
 * US-379 "Adicionar item salvo": "Suplementos" e "Fitoterápicos"; escolher um **copia** o item para o rascunho, no
 * cliente, sem gravar (editar o item salvo depois não muda a receita). Sem a habilitação, o fitoterápico formulado fica
 * `aria-disabled`, com a mensagem `semHabilitacao` ligada por `aria-describedby`. `focoAoFechar`: o título da lista, se
 * o botão que abriu sumiu (a receita chegou a 20 itens).
 */
export function AdicionarItemSalvo({ itens, habilitada, aoAdicionar, focoAoFechar }: { itens: ItemSalvoDaReceita[]; habilitada: boolean; aoAdicionar: (item: ItemPrescricao) => void; focoAoFechar: () => HTMLElement | null }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const id = useId();
  const fechar = () => setDestino(null);
  const grupos = (Object.keys(TIPOS_DO_GRUPO) as GrupoDeItens[]).map((g) => ({ g, itens: itens.filter((i) => (TIPOS_DO_GRUPO[g] as readonly string[]).includes(i.tipo)) }));
  const travado = (i: ItemSalvoDaReceita) => exigeHabilitacao(i.tipo) && !habilitada;
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {M.adicionarItem}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={M.adicionarItem} aoFechar={fechar} focoAoFechar={focoAoFechar}>
            {itens.length === 0 ? (
              <p>{M.vazioAdicionar}</p>
            ) : (
              <div className="space-y-4">
                {itens.some(travado) && (
                  <p id={`${id}-sem-habilitacao`} className="text-sm text-suave">
                    {MSG_PRESCRICAO.semHabilitacao}
                  </p>
                )}
                {grupos
                  .filter((x) => x.itens.length > 0)
                  .map(({ g, itens: doGrupo }) => (
                    <section key={g} aria-labelledby={`${id}-${g}`} className="space-y-2">
                      <h3 id={`${id}-${g}`} className="font-semibold">
                        {M.secoes[g]}
                      </h3>
                      <ul className="divide-y divide-linha">
                        {doGrupo.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <span className="min-w-0 wrap-anywhere">
                              <span className="font-semibold">{i.nome}</span>
                              <span className="text-suave">{` · ${TIPOS_ITEM[i.tipo as keyof typeof TIPOS_ITEM] ?? i.tipo}`}</span>
                            </span>
                            <Botao
                              type="button"
                              variante="secundario"
                              aria-label={M.adicionarRotulo(i.nome)}
                              aria-disabled={travado(i) || undefined}
                              aria-describedby={travado(i) ? `${id}-sem-habilitacao` : undefined}
                              className="aria-disabled:opacity-60"
                              onClick={() => {
                                if (travado(i)) return;
                                aoAdicionar(i.item);
                                fechar();
                              }}
                            >
                              {M.adicionar}
                            </Botao>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
              </div>
            )}
          </Dialogo>,
          destino,
        )}
    </>
  );
}

/**
 * RN-394, EP-D30 "Carregar modelo": a lista dos modelos, cada um com "Acrescentar aos itens" e "Substituir os itens" (com
 * a confirmação "Substituir os {n} itens da receita pelos do modelo?" quando a receita já tem itens, num diálogo por cima
 * deste). `carregar` manda o que está na tela ao servidor, que grava pelo caminho do "Salvar rascunho" (todas as
 * conferências; tudo ou nada) e devolve o conteúdo gravado; `aoCarregado` remonta a receita com ele. Recusado (mais de 20
 * itens, habilitação, item da tela incompleto), as mensagens ficam neste diálogo e nada muda.
 */
export function CarregarModelo({
  modelos,
  quantos,
  carregar,
  aoCarregado,
  focoAoFechar,
}: {
  modelos: ModeloDaReceita[];
  quantos: number;
  carregar: (modeloId: string, modo: 'acrescentar' | 'substituir') => Promise<EstadoForm & { conteudo?: ConteudoReceita }>;
  aoCarregado: (conteudo: ConteudoReceita) => void;
  focoAoFechar: () => HTMLElement | null;
}) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const [substituir, setSubstituir] = useState<ModeloDaReceita | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [pendente, iniciar] = useTransition();
  const fechar = () => {
    setDestino(null);
    setSubstituir(null);
    setErros([]);
  };
  const executar = (m: ModeloDaReceita, modo: 'acrescentar' | 'substituir') =>
    iniciar(async () => {
      setErros([]);
      const r = await carregar(m.id, modo);
      if (r.conteudo) aoCarregado(r.conteudo);
      else setErros(mensagens(r.erros));
    });
  const desligado = pendente || undefined;
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {M.carregarModelo}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={M.carregarModelo} aoFechar={fechar} ocupado={pendente} focoAoFechar={focoAoFechar}>
            {modelos.length === 0 ? (
              <p>
                {M.semModelo}{' '}
                <Link href="/painel/prescricao/modelos" prefetch={false} className="text-link underline">
                  {M.secoes.modelos}
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {erros.length > 0 && (
                  <div role="alert" className="space-y-1 text-erro">
                    {erros.map((m) => (
                      <p key={m}>{m}</p>
                    ))}
                  </div>
                )}
                <ul className="divide-y divide-linha">
                  {modelos.map((m) => (
                    <li key={m.id} className="space-y-2 py-2">
                      <p>
                        <span className="font-semibold wrap-anywhere">{m.nome}</span>
                        <span className="text-suave">{` · ${M.itensN(m.itens)}`}</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Botao type="button" variante="secundario" aria-label={M.acrescentarRotulo(m.nome)} aria-disabled={desligado} className="aria-disabled:opacity-60" onClick={() => !pendente && executar(m, 'acrescentar')}>
                          {M.acrescentar}
                        </Botao>
                        <Botao
                          type="button"
                          variante="secundario"
                          aria-label={M.substituirRotulo(m.nome)}
                          aria-disabled={desligado}
                          className="aria-disabled:opacity-60"
                          onClick={() => {
                            if (pendente) return;
                            // receita sem itens: nada a substituir, sem confirmação
                            if (quantos === 0) executar(m, 'substituir');
                            else setSubstituir(m);
                          }}
                        >
                          {M.substituir}
                        </Botao>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Dialogo>,
          destino,
        )}
      {destino &&
        substituir &&
        createPortal(
          <DialogoConfirmar
            aberto
            perigo
            titulo={M.substituir}
            texto={M.confirmarSubstituir(quantos)}
            confirmar={M.substituir}
            cancelar={M.cancelar}
            aoFechar={() => setSubstituir(null)}
            aoConfirmar={() => {
              const m = substituir;
              setSubstituir(null);
              executar(m, 'substituir');
            }}
          />,
          destino,
        )}
    </>
  );
}
