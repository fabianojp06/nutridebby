'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { Campo } from '@/components/campo';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import type { ExameDaLista } from '@/db/schema/exames-catalogo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { MSG_SOLICITACAO } from '@/modules/documentos/solicitacao';
import { normalizarNome } from '@/modules/ia/correspondencia';
import { EscolherDoCatalogo, type ItemDoCatalogo } from '../escolher-do-catalogo';
import type { ModeloSolicitacaoState } from './actions';

const M = MSG_EXAMES.modelosSolicitacao;
const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

type Inicial = { nome: string; exames: ExameDaLista[]; orientacoes: string };

function examesDoJson(texto: string): ExameDaLista[] {
  try {
    const v: unknown = JSON.parse(texto);
    if (!Array.isArray(v)) return [];
    return v.flatMap((x: unknown) => {
      const e = (x ?? {}) as { nome?: unknown; painel?: unknown };
      return typeof e.nome === 'string' ? [e.painel === true ? { nome: e.nome, painel: true as const } : { nome: e.nome }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Plano 22 (T3, US-376, RN-391): o modelo de solicitação — "Nome do modelo", "Exames" (do catálogo, pelo `Dialogo`
 * "Buscar no catálogo" em modo `lista`, ou digitados fora do catálogo; "Remover" por exame) e "Orientações ao paciente
 * (opcional)". **Sem** indicação clínica; o aviso "Retire dados do paciente antes de salvar." fica acima dos campos. A
 * lista vai como JSON (`exames`); depois de um erro, volta com o que foi digitado (`valores`, `key`).
 */
export function ModeloForm({ acao, inicial, catalogo }: { acao: (s: ModeloSolicitacaoState, fd: FormData) => Promise<ModeloSolicitacaoState>; inicial: Inicial; catalogo: ItemDoCatalogo[] }) {
  const [state, action, pendente] = useActionState(acao, {});
  const valores: Inicial = state.valores ? { nome: state.valores.nome, exames: examesDoJson(state.valores.exames), orientacoes: state.valores.orientacoes } : inicial;
  return (
    <form action={action} noValidate className="space-y-6">
      <Aviso tipo="aviso" papel="nenhum">
        {M.aviso}
      </Aviso>
      <Campos key={state.envio ?? 0} inicial={valores} erros={state.erros ?? {}} catalogo={catalogo} />
      {state.erros?.geral && (
        <p role="alert" className="text-erro">
          {state.erros.geral}
        </p>
      )}
      <Botao type="submit" disabled={pendente}>
        {MSG_EXAMES.exameDoCatalogo.salvar}
      </Botao>
    </form>
  );
}

function Campos({ inicial, erros, catalogo }: { inicial: Inicial; erros: Record<string, string>; catalogo: ItemDoCatalogo[] }) {
  const [exames, setExames] = useState<ExameDaLista[]>(inicial.exames);
  const [livre, setLivre] = useState('');
  const [erroLivre, setErroLivre] = useState('');
  const id = useId();
  const idLivre = `${id}-livre`;
  const titulo = useRef<HTMLHeadingElement>(null);
  const erroDaLista = erros.exames ?? Object.entries(erros).find(([k]) => /^exames\.\d+\.nome$/.test(k))?.[1];

  const acrescentar = (novos: ExameDaLista[]) =>
    setExames((atual) => {
      const vistos = new Set(atual.map((e) => normalizarNome(e.nome)));
      const fora = novos.filter((e) => {
        const n = normalizarNome(e.nome);
        if (vistos.has(n)) return false;
        vistos.add(n);
        return true;
      });
      return [...atual, ...fora];
    });
  const adicionarLivre = () => {
    const nome = livre.trim().replace(/\s+/g, ' ');
    if (!nome) return;
    if (exames.some((e) => normalizarNome(e.nome) === normalizarNome(nome))) {
      setErroLivre(M.erros.exameRepetido);
      return;
    }
    setErroLivre('');
    acrescentar([{ nome }]);
    setLivre('');
  };

  return (
    <>
      <Campo id="nome" rotulo={M.nome} required maxLength={80} defaultValue={inicial.nome} erro={erros.nome} />
      <section aria-labelledby={`${id}-exames`} className="space-y-3 rounded-3xl border border-borda bg-cartao p-5">
        {/* tabIndex -1: o foco vem para cá depois de "Remover" (o botão sai da lista) */}
        <h2 ref={titulo} id={`${id}-exames`} tabIndex={-1} className="font-titulo text-lg font-semibold">
          {M.exames} <span className="text-base font-normal text-suave">({M.examesN(exames.length)})</span>
        </h2>
        <input type="hidden" name="exames" value={JSON.stringify(exames)} />
        {erroDaLista && (
          <p role="alert" className="text-erro">
            {erroDaLista}
          </p>
        )}
        {exames.length > 0 && (
          <ul className="divide-y divide-linha">
            {exames.map((e, i) => (
              <li key={`${i}-${e.nome}`} className="flex flex-wrap items-center justify-between gap-3 py-1">
                <span>
                  {e.nome}
                  {e.painel && <span className="text-suave"> · {MSG_EXAMES.catalogo.painel(catalogo.find((c) => c.nome === e.nome)?.componentes.length ?? 0)}</span>}
                </span>
                <Botao type="button" variante="secundario" aria-label={M.removerRotulo(e.nome)} onClick={() => {
                    setExames((xs) => xs.filter((x) => x !== e));
                    titulo.current?.focus();
                  }}
                >
                  {MSG_EXAMES.lancamento.remover}
                </Botao>
              </li>
            ))}
          </ul>
        )}
        <EscolherDoCatalogo modo="lista" catalogo={catalogo} aoAdicionar={acrescentar} />
        <div className="space-y-1">
          <label htmlFor={idLivre} className="block font-medium">
            {MSG_SOLICITACAO.adicionarForaDoCatalogo}
          </label>
          <p id={`${idLivre}-dica`} className="text-sm text-suave">
            {MSG_SOLICITACAO.ajudaForaDoCatalogo}
          </p>
          <div className="flex flex-wrap gap-3">
            <input
              id={idLivre}
              value={livre}
              maxLength={80}
              onChange={(e) => setLivre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  adicionarLivre();
                }
              }}
              aria-invalid={erroLivre ? true : undefined}
              aria-describedby={[`${idLivre}-dica`, erroLivre ? `${idLivre}-erro` : null].filter(Boolean).join(' ')}
              className={`${CAMPO} max-w-md flex-1`}
            />
            <Botao type="button" variante="secundario" onClick={adicionarLivre}>
              {M.adicionar}
            </Botao>
          </div>
          {erroLivre && (
            <p id={`${idLivre}-erro`} role="alert" className="text-sm text-erro">
              {erroLivre}
            </p>
          )}
        </div>
      </section>
      <div className="space-y-1">
        <label htmlFor="orientacoes" className="block font-medium">
          {M.orientacoes}
        </label>
        <p id="orientacoes-dica" className="text-sm text-suave">
          {MSG_SOLICITACAO.ajudaOrientacoes}
        </p>
        <textarea
          id="orientacoes"
          name="orientacoes"
          rows={4}
          maxLength={1000}
          defaultValue={inicial.orientacoes}
          aria-invalid={erros.orientacoes ? true : undefined}
          aria-describedby={['orientacoes-dica', erros.orientacoes ? 'orientacoes-erro' : null].filter(Boolean).join(' ')}
          className={CAMPO}
        />
        {erros.orientacoes && (
          <p id="orientacoes-erro" role="alert" className="text-sm text-erro">
            {erros.orientacoes}
          </p>
        )}
      </div>
    </>
  );
}
