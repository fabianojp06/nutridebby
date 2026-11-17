'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import type { TipoLancamento } from '@/db/schema/financeiro';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { focarTitulo } from '../foco';
import { Mensagens } from '../mensagens';
import { categoriaAction, novaCategoriaAction, type CategoriaFeita, type CategoriaState } from './actions';

export type CategoriaNaTela = { id: string; tipo: TipoLancamento; nome: string; arquivada: boolean; fixa: boolean };

const C = MSG_FINANCEIRO.configuracoes;
const ACAO = 'inline-flex min-h-11 items-center px-2 text-link underline disabled:opacity-60';
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const DO_TIPO: Record<TipoLancamento, string> = { entrada: ' de entrada', saida: ' de saída' };
const FEITO: Record<CategoriaFeita, (nome: string) => string> = C.feito;

/** O retorno de cada ação para a região de status da seção; texto vazio (um erro, que tem o próprio `role="alert"`) a limpa. */
type Avisar = (texto: string) => void;
const nomeDigitado = (fd: FormData) => String(fd.get('nome') ?? '').trim();

/**
 * RN-303: as categorias por tipo ("Entradas", "Saídas"), com "Nova categoria" em cada lista. O nome acessível de cada botão
 * começa pelo texto visível e cita a categoria ("Arquivar categoria Divulgação", WCAG 2.5.3). O resultado de cada ação
 * ("Categoria Divulgação arquivada.") vai para uma região `role="status"` sempre montada, acima das listas e fora das
 * linhas (§7: a linha excluída sai da tela); o `marcador` faz o mesmo texto ser anunciado de novo.
 */
export function Categorias({ categorias }: { categorias: CategoriaNaTela[] }) {
  const [aviso, setAviso] = useState({ texto: '', n: 0 });
  const avisar: Avisar = (texto) => setAviso((a) => ({ texto, n: a.n + 1 }));
  return (
    <section aria-labelledby="categorias-titulo" data-guia="financeiro-categorias" className="space-y-4 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="categorias-titulo" className="font-titulo text-lg font-semibold">
        {C.categorias}
      </h2>
      <Mensagens texto={aviso.texto} tipo="ok" focar={false} marcador={String(aviso.n)} />
      <div className="grid gap-6 md:grid-cols-2">
        {(['entrada', 'saida'] as const).map((tipo) => (
          <div key={tipo} className="space-y-3">
            <h3 id={`categorias-${tipo}`} className="font-semibold">
              {tipo === 'entrada' ? C.entradas : C.saidas}
            </h3>
            <ul aria-labelledby={`categorias-${tipo}`}>
              {categorias
                .filter((c) => c.tipo === tipo)
                .map((c) => (
                  <LinhaDaCategoria key={c.id} c={c} avisar={avisar} />
                ))}
            </ul>
            <NovaCategoria tipo={tipo} avisar={avisar} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Uma categoria. "Renomear" abre o campo do nome na própria linha; salvo, o campo fecha e o foco volta ao botão (a linha
 * pode mudar de lugar na lista, que é por nome). "Arquivar" e "Reativar" são o mesmo botão, e o foco volta a ele (o botão
 * fica desabilitado durante o envio e perderia o foco). "Excluir" tira a linha: o foco vai para o h1 (§7). Numa recusa, o
 * foco volta ao campo do nome (renomear) ou ao botão tocado, ao lado do `role="alert"`. "Consultas" (a categoria da
 * cobrança) não tem "Excluir"; "Arquivar" fica, e a recusa do módulo explica o porquê (US-300).
 */
function LinhaDaCategoria({ c, avisar }: { c: CategoriaNaTela; avisar: Avisar }) {
  const [renomeando, setRenomeando] = useState(false);
  const botaoRenomear = useRef<HTMLButtonElement>(null);
  const botaoArquivar = useRef<HTMLButtonElement>(null);
  const botaoExcluir = useRef<HTMLButtonElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const ultimaAcao = useRef('');
  const [state, acao, pendente] = useActionState<CategoriaState, FormData>(async (prev, fd) => {
    ultimaAcao.current = String(fd.get('acao') ?? '');
    const r = await categoriaAction(prev, fd);
    if (r.feito === 'renomeada') setRenomeando(false);
    // a linha excluída sai da tela na mesma renderização: o foco e o aviso saem daqui, não de um efeito da linha
    if (r.feito === 'excluida') focarTitulo();
    avisar(r.feito ? FEITO[r.feito](r.feito === 'renomeada' ? nomeDigitado(fd) : c.nome) : '');
    return r;
  }, {});
  useEffect(() => {
    if (!state.envio) return;
    if (state.feito === 'renomeada') botaoRenomear.current?.focus();
    else if (state.feito === 'arquivada' || state.feito === 'reativada') botaoArquivar.current?.focus();
    else if (state.erros) {
      const alvo = ultimaAcao.current === 'renomear' ? campoNome : ultimaAcao.current === 'excluir' ? botaoExcluir : botaoArquivar;
      alvo.current?.focus();
    }
  }, [state]);
  const e = state.erros ?? {};
  const daCategoria = ` categoria ${c.nome}`;
  const idNome = `nome-${c.id}`;
  return (
    <li className="space-y-1 border-t border-linha py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{c.nome}</span>
        {c.arquivada && <Selo>{C.arquivada}</Selo>}
        <div className="ml-auto flex flex-wrap">
          <button
            ref={botaoRenomear}
            type="button"
            aria-expanded={renomeando}
            aria-controls={`renomear-${c.id}`}
            onClick={() => setRenomeando(!renomeando)}
            className={ACAO}
          >
            {C.renomear}
            <span className="sr-only">{daCategoria}</span>
          </button>
          <form action={acao} noValidate className="contents">
            <input type="hidden" name="id" value={c.id} />
            <button ref={botaoArquivar} name="acao" value={c.arquivada ? 'reativar' : 'arquivar'} disabled={pendente} className={ACAO}>
              {c.arquivada ? C.reativar : C.arquivar}
              <span className="sr-only">{daCategoria}</span>
            </button>
            {!c.fixa && (
              <button ref={botaoExcluir} name="acao" value="excluir" disabled={pendente} className={ACAO}>
                {C.excluir}
                <span className="sr-only">{daCategoria}</span>
              </button>
            )}
          </form>
        </div>
      </div>
      {renomeando && (
        <form id={`renomear-${c.id}`} action={acao} noValidate className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="acao" value="renomear" />
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={idNome} className="block font-medium">
              Novo nome
              <span className="sr-only">{` da${daCategoria}`}</span>
            </label>
            {/* a chave só no campo: o formulário e o botão "Salvar" ficam; o campo volta com o que foi digitado (React 19) */}
            <input
              key={state.envio}
              ref={campoNome}
              id={idNome}
              name="nome"
              autoComplete="off"
              defaultValue={e.nome ? state.valores?.nome : c.nome}
              aria-invalid={e.nome ? true : undefined}
              aria-describedby={e.nome ? `${idNome}-erro` : undefined}
              className={CAMPO}
            />
            {e.nome && (
              <p id={`${idNome}-erro`} role="alert" className="text-sm text-erro">
                {e.nome}
              </p>
            )}
          </div>
          <Botao variante="secundario" disabled={pendente}>
            {C.salvar}
            <span className="sr-only">{` o nome da${daCategoria}`}</span>
          </Botao>
        </form>
      )}
      {e.geral && (
        <p role="alert" className="text-sm text-erro">
          {e.geral}
        </p>
      )}
    </li>
  );
}

/**
 * "Nova categoria". A chave fica só no campo (o formulário não remonta): salva, o campo volta vazio; recusada, volta com o
 * que foi digitado. Nos dois casos o foco volta ao campo (o botão fica desabilitado durante o envio e perderia o foco),
 * pronto para a próxima categoria ou para corrigir o nome, e o resultado vai para a região de status da seção.
 */
function NovaCategoria({ tipo, avisar }: { tipo: TipoLancamento; avisar: Avisar }) {
  const campo = useRef<HTMLInputElement>(null);
  const [state, acao, pendente] = useActionState<CategoriaState, FormData>(async (prev, fd) => {
    const r = await novaCategoriaAction(prev, fd);
    avisar(r.feito === 'criada' ? FEITO.criada(nomeDigitado(fd)) : '');
    return r;
  }, {});
  useEffect(() => {
    if (state.envio) campo.current?.focus();
  }, [state.envio]);
  const id = `nova-categoria-${tipo}`;
  const erro = state.erros?.nome ?? state.erros?.geral;
  return (
    <form action={acao} noValidate className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tipo" value={tipo} />
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor={id} className="block font-medium">
          {C.novaCategoria}
          <span className="sr-only">{DO_TIPO[tipo]}</span>
        </label>
        <input
          key={state.envio}
          ref={campo}
          id={id}
          name="nome"
          autoComplete="off"
          defaultValue={state.erros ? state.valores?.nome : ''}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-erro` : undefined}
          className={CAMPO}
        />
        {erro && (
          <p id={`${id}-erro`} role="alert" className="text-sm text-erro">
            {erro}
          </p>
        )}
      </div>
      <Botao variante="secundario" disabled={pendente}>
        {C.salvar}
        <span className="sr-only">{` a nova categoria${DO_TIPO[tipo]}`}</span>
      </Botao>
    </form>
  );
}
