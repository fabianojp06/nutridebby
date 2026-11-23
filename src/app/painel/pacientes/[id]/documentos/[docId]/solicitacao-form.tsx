'use client';

import Link from 'next/link';
import { useActionState, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo, DialogoConfirmar } from '@/components/dialogo';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import type { ExameDaLista } from '@/db/schema/exames-catalogo';
import { EscolherDoCatalogo, type ItemDoCatalogo } from '@/app/painel/exames/escolher-do-catalogo';
import { INDICACAO_MAX, MSG_SOLICITACAO, ORIENTACOES_SOLICITACAO_MAX, type ConteudoSolicitacao } from '@/modules/documentos/solicitacao';
import { LISTA_DE_EXAMES_MAX, MSG_EXAMES, NOME_MAX } from '@/modules/exames/constantes';
import { normalizarNome } from '@/modules/ia/correspondencia';
import { prepararSolicitacaoAction, salvarSolicitacaoAction, type EstadoForm } from '../actions';
import { MotivoRetificacao } from './motivo-retificacao';
import { OrientacoesCampo } from './orientacoes-campo';
import { Preparar } from './preparar';

/** Um modelo de solicitação do consultório (cópia dos exames e as orientações; sem indicação clínica, RN-391). */
export type ModeloDaSolicitacao = { id: string; nome: string; exames: ExameDaLista[]; orientacoes: string };
type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };

const S = MSG_SOLICITACAO;
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
/** As chaves de erro que um campo do editor mostra; as que sobrarem vão para o aviso geral (nenhum erro some em silêncio). */
const CAMPOS = new Set(['geral', 'motivoRetificacao', 'exames', 'indicacaoClinica', 'orientacoes', 'declaracao']);
const daLinha = /^exames\.\d+\.nome$/;
/** O contêiner do tema mais próximo do botão: o diálogo vai para fora do `<form>` da tela com os tokens de cor (contrato do `Dialogo`). */
const destinoDe = (el: HTMLElement) => el.closest<HTMLElement>('[data-tema]') ?? document.body;
const chave = (nome: string) => normalizarNome(nome) || nome.toLowerCase();

/** Acrescenta sem repetir (nome normalizado, como o servidor). Passar de 40 não é cortado em silêncio: o servidor recusa com o texto da spec. */
function semRepetir(atuais: ExameDaLista[], novos: ExameDaLista[]): ExameDaLista[] {
  const vistos = new Set(atuais.map((e) => chave(e.nome)));
  const entram = novos.filter((e) => {
    const k = chave(e.nome);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return [...atuais, ...entram];
}

/**
 * "Carregar modelo" (US-377, RN-391): a lista dos modelos, cada um com "Acrescentar" (sem repetir) e "Substituir" (com a
 * confirmação "Substituir os {n} exames da solicitação pelos do modelo?" quando a lista já tem exames). Os diálogos vão
 * para fora do `<form>` por `createPortal` e só existem abertos.
 */
function CarregarModelo({ modelos, quantos, aoCarregar }: { modelos: ModeloDaSolicitacao[]; quantos: number; aoCarregar: (m: ModeloDaSolicitacao, modo: 'acrescentar' | 'substituir') => void }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const [substituir, setSubstituir] = useState<{ modelo: ModeloDaSolicitacao; destino: HTMLElement } | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {S.carregarModelo}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={S.carregarModelo} aoFechar={() => setDestino(null)}>
            {modelos.length === 0 ? (
              <p>
                {MSG_EXAMES.vazios.semModelo}{' '}
                <Link href="/painel/exames/modelos/novo" prefetch={false} className="text-link underline">
                  {MSG_EXAMES.modelosSolicitacao.novo}
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-linha">
                {modelos.map((m) => (
                  <li key={m.id} className="space-y-2 py-2">
                    <p>
                      <span className="font-semibold">{m.nome}</span>
                      <span className="text-suave">{` · ${MSG_EXAMES.modelosSolicitacao.examesN(m.exames.length)}`}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Botao
                        type="button"
                        variante="secundario"
                        aria-label={S.acrescentarRotulo(m.nome)}
                        onClick={() => {
                          aoCarregar(m, 'acrescentar');
                          setDestino(null);
                        }}
                      >
                        {S.acrescentar}
                      </Botao>
                      <Botao
                        type="button"
                        variante="secundario"
                        aria-label={S.substituirRotulo(m.nome)}
                        onClick={() => {
                          // lista vazia: nada a substituir, sem confirmação
                          if (quantos === 0) aoCarregar(m, 'substituir');
                          else setSubstituir({ modelo: m, destino });
                          setDestino(null);
                        }}
                      >
                        {S.substituir}
                      </Botao>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Dialogo>,
          destino,
        )}
      {substituir &&
        createPortal(
          <DialogoConfirmar
            aberto
            perigo
            titulo={S.substituir}
            texto={S.confirmarSubstituir(quantos)}
            confirmar={S.substituir}
            cancelar={MSG_EXAMES.lancamento.cancelar}
            aoFechar={() => setSubstituir(null)}
            aoConfirmar={() => {
              aoCarregar(substituir.modelo, 'substituir');
              setSubstituir(null);
            }}
          />,
          substituir.destino,
        )}
    </>
  );
}

/** "Remover todos" com a confirmação "Remover"/"Cancelar" (nada muda até salvar). */
function RemoverTodos({ aoRemover, focoAoFechar }: { aoRemover: () => void; focoAoFechar: () => HTMLElement | null }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {S.removerTodos}
      </Botao>
      {destino &&
        createPortal(
          <DialogoConfirmar
            aberto
            perigo
            titulo={S.removerTodos}
            texto={S.confirmarRemoverTodos}
            confirmar={MSG_EXAMES.lancamento.remover}
            cancelar={MSG_EXAMES.lancamento.cancelar}
            aoFechar={() => setDestino(null)}
            // confirmado, o próprio "Remover todos" some (sem exames): o foco vai ao título da lista
            focoAoFechar={focoAoFechar}
            aoConfirmar={() => {
              aoRemover();
              setDestino(null);
            }}
          />,
          destino,
        )}
    </>
  );
}

/**
 * Plano 22 (T8, US-377, RN-388, §6.2, §7): o editor da solicitação de exames laboratoriais — e o preparo, no mesmo
 * formulário, como a receita e o parecer (o botão envia o que está na tela). "Exames" com "Remover" por exame (um painel
 * é um item, com o nome dele), "Adicionar do catálogo" (`EscolherDoCatalogo`, modo `lista`), "Adicionar exame fora do
 * catálogo" com a ajuda fixa da Lei 8.234, "Carregar modelo" e "Remover todos"; "Indicação clínica (opcional)" com a linha
 * fixa e "Orientações ao paciente (opcional)" com a ajuda, a barra de marcação e a prévia (`OrientacoesCampo`, T9); o aviso dos planos de saúde (só na tela, nunca no PDF, EP-D4); a declaração da solicitação no preparo. **Nenhum
 * campo de laboratório** (EP-D2, C-374). Tudo controlado (o React 19 reseta campos não controlados depois de cada action).
 */
export function SolicitacaoForm({
  patientId,
  docId,
  conteudo,
  catalogo,
  modelos,
  declaracao,
  motivo = null,
}: {
  patientId: string;
  docId: string;
  conteudo: ConteudoSolicitacao;
  catalogo: ItemDoCatalogo[];
  modelos: ModeloDaSolicitacao[];
  declaracao: string;
  motivo?: string | null;
}) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    // o botão que enviou vem no FormData (submitter); Enter num campo envia pelo primeiro, "Salvar rascunho"
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararSolicitacaoAction : salvarSolicitacaoAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const [exames, setExames] = useState<ExameDaLista[]>(conteudo.exames);
  const [indicacao, setIndicacao] = useState(conteudo.indicacaoClinica ?? '');
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [livre, setLivre] = useState('');
  const [erroLivre, setErroLivre] = useState('');
  const [declarada, setDeclarada] = useState(false);
  // Q13-1 ★: null = não é retificação (o campo não aparece nem vai no formulário)
  const [motivoRet, setMotivoRet] = useState(motivo ?? '');
  const titulo = useRef<HTMLLegendElement>(null);
  const e = s.erros ?? {};
  const componentes = new Map(catalogo.map((c) => [c.nome, c.componentes.length]));

  /** RNF-10: o controle com erro leva aria-invalid; a ajuda e o erro ficam no aria-describedby. */
  const aria = (k: string, dica?: string) => {
    const descr = [dica, e[k] ? `${k}-erro` : undefined].filter(Boolean).join(' ');
    return { 'aria-invalid': e[k] ? (true as const) : undefined, 'aria-describedby': descr || undefined };
  };
  const msg = (k: string) => e[k] && <p id={`${k.replace(/\./g, '-')}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  /** O erro da lista e o de uma linha ficam junto dela sem região viva: quem anuncia é o aviso perto do botão usado (abaixo). */
  const msgDaLista = (k: string) => e[k] && <p id={`${k.replace(/\./g, '-')}-erro`} className="text-sm text-erro">{e[k]}</p>;

  const adicionarLivre = () => {
    const nome = livre.replace(/\s+/g, ' ').trim();
    if (!nome) return;
    if (exames.some((x) => chave(x.nome) === chave(nome))) return setErroLivre(S.erros.repetido);
    if (exames.length >= LISTA_DE_EXAMES_MAX) return setErroLivre(S.erros.max);
    setErroLivre('');
    setExames((xs) => semRepetir(xs, [{ nome }]));
    setLivre('');
  };
  const carregar = (m: ModeloDaSolicitacao, modo: 'acrescentar' | 'substituir') => {
    setExames((xs) => (modo === 'substituir' ? semRepetir([], m.exames) : semRepetir(xs, m.exames)));
    // RN-391: as orientações do modelo só entram se as da tela estiverem vazias
    if (!orientacoes.trim() && m.orientacoes) setOrientacoes(m.orientacoes);
  };

  // o erro da lista de exames (vazia, mais de 40) e os das linhas se repetem perto do botão usado: a lista fica no topo do
  // editor e, depois de um modelo ou do catálogo, pode ter mais de 40 linhas — o botão está no fim (mesmo texto da spec)
  const daLista = [e.exames, ...Object.keys(e).filter((k) => daLinha.test(k)).map((k) => e[k])].filter(Boolean);
  const sobras = [...new Set([...daLista, ...Object.keys(e).filter((k) => !CAMPOS.has(k) && !daLinha.test(k)).map((k) => e[k])])];
  const aviso: ReactNode = (e.geral || sobras.length > 0) && (
    <div role="alert" className="space-y-1 text-erro">
      {e.geral && (
        <p>
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      {sobras.map((m) => <p key={m}>{m}</p>)}
    </div>
  );

  return (
    <form action={action} className="space-y-6" data-guia="editor-solicitacao">
      <input type="hidden" name="conteudo" value={JSON.stringify({ exames, indicacaoClinica: indicacao, orientacoes })} />
      {/* EP-D4: o aviso fica na tela (nunca no PDF); sem papel de região viva: é fixo */}
      <Aviso tipo="aviso" papel="nenhum">
        {S.avisoPlanos}
      </Aviso>
      {motivo !== null && <MotivoRetificacao valor={motivoRet} aoMudar={setMotivoRet} erro={e.motivoRetificacao} />}

      {/* só aria-describedby: aria-invalid não vale num grupo (fieldset) */}
      <fieldset id="exames" className="space-y-3 rounded-2xl border border-borda p-4" aria-describedby={e.exames ? 'exames-erro' : undefined}>
        {/* tabIndex -1: o foco vem para cá depois de "Remover" e de "Remover todos" (o botão sai da lista) */}
        <legend ref={titulo} tabIndex={-1} className="px-1 font-semibold">
          {S.exames} <span className="font-normal text-suave">({MSG_EXAMES.modelosSolicitacao.examesN(exames.length)})</span>
        </legend>
        {msgDaLista('exames')}
        {exames.length > 0 && (
          <ul className="divide-y divide-linha">
            {exames.map((x, i) => (
              <li key={`${i}-${x.nome}`} className="py-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* T12 (Minor da T8): nome longo sem espaço quebra a 360 px */}
                  <span className="min-w-0 wrap-break-word">
                    {x.nome}
                    {x.painel && <span className="text-suave"> · {MSG_EXAMES.catalogo.painel(componentes.get(x.nome) ?? 0)}</span>}
                  </span>
                  <Botao
                    type="button"
                    variante="secundario"
                    aria-label={MSG_EXAMES.modelosSolicitacao.removerRotulo(x.nome)}
                    onClick={() => {
                      setExames((xs) => xs.filter((_, j) => j !== i));
                      titulo.current?.focus();
                    }}
                  >
                    {MSG_EXAMES.lancamento.remover}
                  </Botao>
                </div>
                {msgDaLista(`exames.${i}.nome`)}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <EscolherDoCatalogo modo="lista" catalogo={catalogo} aoAdicionar={(novos) => setExames((xs) => semRepetir(xs, novos))} focoAoFechar={() => titulo.current} />
          <CarregarModelo modelos={modelos} quantos={exames.length} aoCarregar={carregar} />
          {exames.length > 0 && <RemoverTodos aoRemover={() => setExames([])} focoAoFechar={() => titulo.current} />}
        </div>
        <div className="space-y-1">
          <label htmlFor="exame-livre" className="block font-medium">
            {S.adicionarForaDoCatalogo}
          </label>
          <p id="exame-livre-dica" className="text-sm text-suave">
            {S.ajudaForaDoCatalogo}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              id="exame-livre"
              value={livre}
              maxLength={NOME_MAX}
              onChange={(ev) => setLivre(ev.target.value)}
              onKeyDown={(ev) => {
                // Enter aqui acrescenta o exame (não envia o formulário)
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  adicionarLivre();
                }
              }}
              aria-invalid={erroLivre ? true : undefined}
              aria-describedby={['exame-livre-dica', erroLivre ? 'exame-livre-erro' : null].filter(Boolean).join(' ')}
              className={`${CAMPO} min-h-11 max-w-md flex-1`}
            />
            <Botao type="button" variante="secundario" onClick={adicionarLivre}>
              {MSG_EXAMES.modelosSolicitacao.adicionar}
            </Botao>
          </div>
          {erroLivre && (
            <p id="exame-livre-erro" role="alert" className="text-sm text-erro">
              {erroLivre}
            </p>
          )}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="indicacaoClinica" className="block font-medium">
          {S.indicacao}
        </label>
        <p id="indicacaoClinica-dica" className="text-sm text-suave">
          {S.indicacaoLinhaFixa}
        </p>
        <textarea id="indicacaoClinica" rows={3} maxLength={INDICACAO_MAX} value={indicacao} onChange={(ev) => setIndicacao(ev.target.value)} {...aria('indicacaoClinica', 'indicacaoClinica-dica')} className={CAMPO} />
        {msg('indicacaoClinica')}
      </div>
      {/* Plano 22 (T9, RN-395): "Negrito", "Lista" e a "Prévia" (marcação mínima, nunca HTML) */}
      <OrientacoesCampo id="orientacoes" rotulo={S.orientacoes} max={ORIENTACOES_SOLICITACAO_MAX} valor={orientacoes} aoMudar={setOrientacoes} dica={S.ajudaOrientacoes} erro={e.orientacoes} />

      {s.intencao !== 'preparar' && aviso}
      {/* sempre montada: "Rascunho salvo." é anunciado quando entra */}
      <p role="status" className="empty:hidden">{s.ok && s.intencao === 'salvar' ? 'Rascunho salvo.' : ''}</p>
      <Botao disabled={pendente}>Salvar rascunho</Botao>
      <Preparar declaracao={declaracao} marcada={declarada} aoMarcar={setDeclarada} erro={e.declaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
