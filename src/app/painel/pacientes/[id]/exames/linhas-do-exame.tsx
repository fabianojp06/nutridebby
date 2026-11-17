'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialogo, DialogoConfirmar } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { lerDecimal } from '@/lib/numero';
import { classificarNeutra, faixaDiverge, formatarLimite, ROTULO_NEUTRA, sugerirFaixa } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { normalizarNome } from '@/modules/ia/correspondencia';
import { EscolherDoCatalogo, type ItemDoCatalogo, type LinhaDaAnalise } from '@/app/painel/exames/escolher-do-catalogo';

/**
 * Plano 22 (T4, US-371, spec §7 "Linhas do lançamento"): os campos das linhas do exame, compartilhados por "Novo exame"
 * (`ExameForm`) e "Editar exame" (`EditarForm`). Cada linha é um grupo rotulado ("Linha {n}: {marcador}") com rótulo
 * visível por campo e número; a faixa do laudo ("de"/"até") com a ajuda "Copie a faixa impressa no laudo."; a
 * classificação neutra ao vivo é texto ligado ao valor por `aria-describedby` (nunca região viva por tecla); o aviso fixo
 * vem uma vez, antes das linhas. "Usar {a} a {b}" só preenche os campos (nada é gravado até salvar; RN-377). Layout: 8
 * células a partir de 1024 px, duas linhas de 768 a 1023 px, empilhado abaixo de 768 px.
 *
 * Os diálogos ("Adicionar do catálogo", "Carregar modelo de solicitação", "Remover todos") são levados para fora do
 * `<form>` da tela por `createPortal`, no contêiner do tema, e só existem abertos (contrato do `Dialogo`, EP-D42).
 */

const L = MSG_EXAMES.lancamento;

export type LinhaDoForm = {
  /** Chave estável do React e dos ids dos campos. */
  chave: number;
  /** Índice da linha gravada que esta continua (edição; `null` = linha nova). A origem da IA só o servidor copia. */
  origem: number | null;
  nome: string;
  valor: string;
  unidade: string;
  referencia: string;
  refMin: string;
  refMax: string;
  /** A linha veio da IA (edição): nome, valor e unidade ficam fixos (RN-378). */
  daIa: boolean;
};
export type ModeloParaCarregar = { id: string; nome: string; linhas: LinhaDaAnalise[] };
type CampoDeTexto = 'nome' | 'valor' | 'unidade' | 'referencia' | 'refMin' | 'refMax';

/**
 * Chaves das linhas acrescentadas depois de montar (só no navegador). As linhas do primeiro desenho usam o índice
 * (0 a 49): o servidor e a hidratação têm de gerar os mesmos ids de campo; este contador começa acima delas.
 */
let proximaChave = 1000;
export const novaChave = (): number => proximaChave++;
export const linhaVazia = (chave: number = novaChave()): LinhaDoForm => ({ chave, origem: null, nome: '', valor: '', unidade: '', referencia: '', refMin: '', refMax: '', daIa: false });
/** O número gravado no campo, com vírgula decimal e todas as casas (sem arredondar: salvar sem mexer não muda o valor). */
const numeroParaCampo = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
/** A linha gravada como o formulário a mostra, com a origem (a chave é o índice: primeiro desenho). */
export function linhaDoGravado(
  v: { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number },
  origem: number,
): LinhaDoForm {
  return {
    chave: origem,
    origem,
    nome: v.nome,
    valor: numeroParaCampo(v.valor),
    unidade: v.unidade ?? '',
    referencia: v.referencia ?? '',
    refMin: numeroParaCampo(v.refMin),
    refMax: numeroParaCampo(v.refMax),
    daIa: !!v.iaTarefaId,
  };
}
/** O que vai ao servidor (o `iaTarefaId` nunca: a origem é só o índice). */
export const linhaParaEnvio = (l: LinhaDoForm) => ({ origem: l.origem, nome: l.nome, valor: l.valor, unidade: l.unidade, referencia: l.referencia, refMin: l.refMin, refMax: l.refMax });
const vazia = (l: LinhaDoForm) => l.origem === null && !l.nome.trim() && !l.valor.trim() && !l.unidade.trim() && !l.referencia.trim() && !l.refMin.trim() && !l.refMax.trim();

/**
 * Acrescenta as linhas da análise (catálogo ou modelo) sem repetir marcador e sem deixar a linha em branco do começo.
 * `gerarChave`: o gerador das chaves (no primeiro desenho, o índice; depois, `novaChave`).
 */
export function acrescentarLinhas(atuais: LinhaDoForm[], novas: LinhaDaAnalise[], gerarChave: () => number = novaChave): LinhaDoForm[] {
  const vistos = new Set(atuais.map((l) => normalizarNome(l.nome)).filter(Boolean));
  const entram: LinhaDoForm[] = [];
  for (const n of novas) {
    const chave = normalizarNome(n.nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    entram.push({ ...linhaVazia(gerarChave()), nome: n.nome, unidade: n.unidade ?? '' });
  }
  return [...atuais.filter((l) => !vazia(l)), ...entram];
}

/** O contêiner do tema mais próximo do botão (para os tokens de cor valerem no diálogo fora do `<form>`). */
const destinoDe = (el: HTMLElement) => el.closest<HTMLElement>('[data-tema]') ?? document.body;

/** "Carregar modelo de solicitação" (US-371): só as linhas do modelo (painéis expandidos); as orientações não entram. */
function CarregarModelo({ modelos, aoCarregar }: { modelos: ModeloParaCarregar[]; aoCarregar: (linhas: LinhaDaAnalise[]) => void }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const fechar = () => setDestino(null);
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {L.carregarModelo}
      </Botao>
      {destino &&
        createPortal(
          <Dialogo aberto titulo={L.carregarModelo} aoFechar={fechar}>
            {modelos.length === 0 ? (
              <p>{MSG_EXAMES.vazios.semModelo}</p>
            ) : (
              <ul className="space-y-2">
                {modelos.map((m) => (
                  <li key={m.id}>
                    <Botao
                      type="button"
                      variante="secundario"
                      className="w-full justify-start text-left"
                      onClick={() => {
                        aoCarregar(m.linhas);
                        fechar();
                      }}
                    >
                      {m.nome}
                      <span className="font-normal text-suave">{` · ${MSG_EXAMES.modelosSolicitacao.examesN(m.linhas.length)}`}</span>
                    </Botao>
                  </li>
                ))}
              </ul>
            )}
          </Dialogo>,
          destino,
        )}
    </>
  );
}

/** "Remover todos" com a confirmação "Remover"/"Cancelar" (nada muda até salvar). */
function RemoverTodos({ aoRemover }: { aoRemover: () => void }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const fechar = () => setDestino(null);
  return (
    <>
      <Botao type="button" variante="secundario" onClick={(e) => setDestino(destinoDe(e.currentTarget))}>
        {L.removerTodos}
      </Botao>
      {destino &&
        createPortal(
          <DialogoConfirmar
            aberto
            perigo
            titulo={L.removerTodos}
            texto={L.confirmarRemoverTodos}
            confirmar={L.remover}
            cancelar={L.cancelar}
            aoFechar={fechar}
            aoConfirmar={() => {
              aoRemover();
              fechar();
            }}
          />,
          destino,
        )}
    </>
  );
}

export function LinhasDoExame({
  idBase,
  linhas,
  aoMudar,
  erros,
  catalogo,
  modelos,
}: {
  /** Prefixo dos ids ("novo", "editar"). */
  idBase: string;
  linhas: LinhaDoForm[];
  aoMudar: (f: (atuais: LinhaDoForm[]) => LinhaDoForm[]) => void;
  /** Erros do servidor: `valores` (a lista) e `valores.{i}.{campo}` (a linha de índice i). */
  erros: Record<string, string>;
  catalogo: ItemDoCatalogo[];
  /** Sem a prop, sem "Carregar modelo de solicitação". */
  modelos?: ModeloParaCarregar[];
}) {
  const idAviso = `${idBase}-aviso-classificacao`;
  const idAjudaFaixa = `${idBase}-ajuda-faixa`;
  const mudar = (chave: number, campo: CampoDeTexto, v: string) => aoMudar((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: v } : l)));
  const adicionar = (novas: LinhaDaAnalise[]) => aoMudar((ls) => acrescentarLinhas(ls, novas));

  return (
    <fieldset className="space-y-3" aria-describedby={erros.valores ? `${idBase}-valores-erro` : undefined}>
      <legend className="font-medium">Valores</legend>
      <div className="flex flex-wrap gap-2">
        <EscolherDoCatalogo modo="linhas" catalogo={catalogo} aoAdicionar={adicionar} />
        {modelos && <CarregarModelo modelos={modelos} aoCarregar={adicionar} />}
        {linhas.length > 0 && <RemoverTodos aoRemover={() => aoMudar(() => [])} />}
        <Botao type="button" variante="secundario" onClick={() => aoMudar((ls) => [...ls, linhaVazia()])}>
          {L.adicionarLinha}
        </Botao>
      </div>
      <p id={idAviso} className="text-sm text-suave">
        {MSG_EXAMES.classificacao.aviso}
      </p>
      <p id={idAjudaFaixa} className="text-sm text-suave">
        {L.ajudaFaixa}
      </p>
      {linhas.map((l, i) => (
        <Linha key={l.chave} idBase={idBase} l={l} i={i} erros={erros} idAviso={idAviso} idAjudaFaixa={idAjudaFaixa} mudar={mudar} remover={() => aoMudar((ls) => ls.filter((x) => x.chave !== l.chave))} />
      ))}
      {erros.valores && (
        <p id={`${idBase}-valores-erro`} role="alert" className="text-sm text-erro">
          {erros.valores}
        </p>
      )}
    </fieldset>
  );
}

function Linha({
  idBase,
  l,
  i,
  erros,
  idAviso,
  idAjudaFaixa,
  mudar,
  remover,
}: {
  idBase: string;
  l: LinhaDoForm;
  i: number;
  erros: Record<string, string>;
  idAviso: string;
  idAjudaFaixa: string;
  mudar: (chave: number, campo: CampoDeTexto, v: string) => void;
  remover: () => void;
}) {
  const n = i + 1;
  const id = (campo: string) => `${idBase}-${campo}-${l.chave}`;
  const erro = (campo: CampoDeTexto) => erros[`valores.${i}.${campo}`];
  const valor = lerDecimal(l.valor);
  const refMin = lerDecimal(l.refMin);
  const refMax = lerDecimal(l.refMax);
  const numero = (x: number | null): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const neutra = typeof valor === 'number' && Number.isFinite(valor) ? classificarNeutra(valor, numero(refMin), numero(refMax)) : null;
  const sugestao = !l.refMin.trim() && !l.refMax.trim() ? sugerirFaixa(l.referencia) : null;
  const diverge = faixaDiverge({ referencia: l.referencia.trim() || null, refMin: numero(refMin), refMax: numero(refMax) });

  const campo = (c: CampoDeTexto, rotulo: string, o: { extra?: string[]; somenteLeitura?: boolean; decimal?: boolean; max?: number; classe?: string } = {}): ReactNode => {
    const msg = erro(c);
    const descritos = [...(o.extra ?? []), ...(msg ? [`${id(c)}-erro`] : [])];
    return (
      <div className={`space-y-1 ${o.classe ?? ''}`}>
        <label htmlFor={id(c)} className="block text-sm">
          {rotulo}
        </label>
        <input
          id={id(c)}
          value={l[c]}
          onChange={(ev) => mudar(l.chave, c, ev.target.value)}
          readOnly={o.somenteLeitura || undefined}
          inputMode={o.decimal ? 'decimal' : undefined}
          maxLength={o.max}
          aria-invalid={msg ? true : undefined}
          aria-describedby={descritos.length ? descritos.join(' ') : undefined}
          className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto read-only:bg-linha"
        />
        {msg && (
          <p id={`${id(c)}-erro`} role="alert" className="text-sm text-erro">
            {msg}
          </p>
        )}
      </div>
    );
  };

  const faixa = [idAjudaFaixa, ...(diverge ? [id('diverge')] : [])];
  return (
    <div
      role="group"
      aria-label={l.nome.trim() ? L.grupoLinha(n, l.nome.trim()) : `Linha ${n}`}
      className="grid gap-2 rounded-2xl border border-linha p-2 md:grid-cols-4 lg:grid-cols-8 lg:items-start"
    >
      {campo('nome', L.marcador(n), { somenteLeitura: l.daIa, max: 80 })}
      {campo('valor', L.valor(n), { somenteLeitura: l.daIa, decimal: true, extra: [...(neutra ? [id('classe')] : []), idAviso] })}
      {campo('unidade', L.unidade(n), { somenteLeitura: l.daIa, max: 20 })}
      {campo('referencia', L.referencia(n), { max: 80 })}
      {campo('refMin', L.faixaDe(n), { decimal: true, extra: faixa })}
      {campo('refMax', L.faixaAte(n), { decimal: true, extra: faixa })}
      <div className="space-y-1 text-sm md:self-end lg:self-auto lg:pt-6">
        {neutra && (
          <p id={id('classe')} className="font-medium">
            {ROTULO_NEUTRA[neutra]}
          </p>
        )}
        {sugestao && (
          <Botao
            type="button"
            variante="secundario"
            aria-label={L.usarFaixaRotulo(formatarLimite(sugestao.refMin), formatarLimite(sugestao.refMax), n)}
            onClick={() => {
              mudar(l.chave, 'refMin', formatarLimite(sugestao.refMin));
              mudar(l.chave, 'refMax', formatarLimite(sugestao.refMax));
            }}
          >
            {L.usarFaixa(formatarLimite(sugestao.refMin), formatarLimite(sugestao.refMax))}
          </Botao>
        )}
        {diverge && (
          <p id={id('diverge')} className="text-aviso">
            {L.faixaDiverge}
          </p>
        )}
        {l.daIa && <p className="text-suave">IA · conferido</p>}
      </div>
      <div className="md:self-end lg:self-auto lg:pt-6">
        <Botao type="button" variante="secundario" aria-label={`Remover a linha ${n}`} onClick={remover}>
          {L.remover}
        </Botao>
      </div>
    </div>
  );
}
