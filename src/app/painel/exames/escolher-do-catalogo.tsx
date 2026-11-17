'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import type { ExameDaLista } from '@/db/schema/exames-catalogo';
import { expandirParaAnalise } from '@/modules/exames/catalogo-regras';
import { indiceDoCatalogo } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { normalizarNome } from '@/modules/ia/correspondencia';

/** O que o diálogo precisa de cada exame do catálogo (as faixas ficam no servidor). */
export type ItemDoCatalogo = { nome: string; unidade: string | null; sinonimos: string[]; componentes: string[] };
export type LinhaDaAnalise = { nome: string; unidade: string | null };

type Props = {
  catalogo: ItemDoCatalogo[];
  className?: string;
  /** O alvo do foco ao fechar, só se o botão que abriu saiu do DOM (repassado ao `Dialogo`). */
  focoAoFechar?: () => HTMLElement | null;
} & (
  | { modo: 'lista'; aoAdicionar: (exames: ExameDaLista[]) => void }
  | { modo: 'linhas'; aoAdicionar: (linhas: LinhaDaAnalise[]) => void }
);

const L = MSG_EXAMES.lancamento;
const V = MSG_EXAMES.vazios;
const [ANTES_DO_LINK, DEPOIS_DO_LINK] = V.catalogoVazio.split(MSG_EXAMES.catalogo.titulo);

/**
 * Plano 22 (T3, spec §6.2 "Lançamento" e "Estados vazios"): "Adicionar do catálogo" — o `Dialogo` "Buscar no catálogo",
 * com a busca pelo nome e pelos outros nomes (sem acento e maiúsculas), "Selecionar todos" (os mostrados) e "Adicionar
 * {n} exame(s)". `modo`: `lista` (modelo de solicitação e solicitação, T8) mantém o painel como um item; `linhas`
 * (lançamento, T4) expande o painel numa linha por componente, com a unidade do exame do catálogo que casar (RN-373).
 * Quem chama decide o que fazer com o que já está na lista (sem repetir).
 *
 * Quem usa fica dentro do `<form>` da tela (modelo, lançamento, solicitação): o `Dialogo` vai para fora dele no DOM por
 * `createPortal`, no contêiner do tema (`[data-tema]` mais próximo do botão, para os tokens de cor valerem), e só existe
 * enquanto está aberto. Assim a busca e as caixas não têm o formulário da tela como dono — o `Enter` na busca não envia o
 * modelo (contrato do `Dialogo`: nunca dentro de `<form>` da tela). Fechar desmonta o diálogo; o foco volta ao botão.
 */
export function EscolherDoCatalogo(p: Props) {
  /** Onde o diálogo aberto é montado; `null` = fechado. */
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const id = useId();

  const mostrados = useMemo(() => {
    const q = normalizarNome(busca);
    if (!q) return p.catalogo;
    return p.catalogo.filter((e) => [e.nome, ...e.sinonimos].some((n) => normalizarNome(n).includes(q)));
  }, [busca, p.catalogo]);

  const fechar = () => {
    setDestino(null);
    setBusca('');
    setMarcados(new Set());
  };
  const alternar = (nome: string) =>
    setMarcados((m) => {
      const novo = new Set(m);
      if (novo.has(nome)) novo.delete(nome);
      else novo.add(nome);
      return novo;
    });
  const escolhidos = p.catalogo.filter((e) => marcados.has(e.nome));
  const adicionar = () => {
    if (!escolhidos.length) return;
    if (p.modo === 'lista') p.aoAdicionar(escolhidos.map((e) => (e.componentes.length ? { nome: e.nome, painel: true as const } : { nome: e.nome })));
    else {
      const indice = indiceDoCatalogo(p.catalogo.map((e) => ({ ...e, id: e.nome, faixas: [] })));
      p.aoAdicionar(expandirParaAnalise(escolhidos.map((e) => ({ nome: e.nome })), indice));
    }
    fechar();
  };

  return (
    <>
      <Botao
        type="button"
        variante="secundario"
        onClick={(e) => setDestino(e.currentTarget.closest<HTMLElement>('[data-tema]') ?? document.body)}
        className={p.className}
      >
        {L.adicionarDoCatalogo}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo
            aberto
            titulo={L.buscar}
            aoFechar={fechar}
            focoAoFechar={p.focoAoFechar}
            rodape={
              <>
                <Botao type="button" variante="secundario" onClick={fechar}>
                  {L.cancelar}
                </Botao>
                {p.catalogo.length > 0 && (
                  <Botao type="button" onClick={adicionar} aria-disabled={escolhidos.length ? undefined : true} className="aria-disabled:opacity-60">
                    {L.adicionarN(escolhidos.length)}
                  </Botao>
                )}
              </>
            }
          >
            {p.catalogo.length === 0 ? (
              <p>
                {ANTES_DO_LINK}
                <Link href="/painel/exames/catalogo" className="text-link underline">
                  {MSG_EXAMES.catalogo.titulo}
                </Link>
                {DEPOIS_DO_LINK}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor={`${id}-busca`} className="block font-medium">
                    {L.buscar}
                  </label>
                  <input
                    id={`${id}-busca`}
                    type="search"
                    data-foco-inicial=""
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
                  />
                </div>
                {/* sempre montada: "Nenhum exame encontrado." é anunciado quando a busca esvazia a lista */}
                <p role="status" className="empty:hidden">{mostrados.length === 0 ? V.semResultado : ''}</p>
                {mostrados.length > 0 && (
                  <>
                    <Botao
                      type="button"
                      variante="secundario"
                      aria-label={L.selecionarTodosRotulo}
                      onClick={() => setMarcados((m) => new Set([...m, ...mostrados.map((e) => e.nome)]))}
                    >
                      {L.selecionarTodos}
                    </Botao>
                    <ul className="space-y-1">
                      {mostrados.map((e) => (
                        <li key={e.nome}>
                          <label className="flex min-h-11 items-center gap-3">
                            <input type="checkbox" checked={marcados.has(e.nome)} onChange={() => alternar(e.nome)} className="size-5" />
                            <span>
                              {e.nome}
                              {e.componentes.length > 0 && <span className="text-suave"> · {MSG_EXAMES.catalogo.painel(e.componentes.length)}</span>}
                              {e.unidade && <span className="text-suave"> · {e.unidade}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </Dialogo>,
          destino,
        )}
    </>
  );
}
