'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { CATEGORIAS_DO_CONSULTORIO, MSG_EXAMES } from '@/modules/exames/constantes';
import { formatarData } from '@/modules/pacientes/datas';
import { faixaVazia, formularioDosValores, type CampoDaFaixa, type ExameDoFormulario, type FaixaDoFormulario } from '../valores';
import type { ExameCatalogoState } from './actions';

const X = MSG_EXAMES.exameDoCatalogo;
const F = MSG_EXAMES.faixas;
const N = MSG_EXAMES.modelosNota;
const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

/**
 * Plano 22 (T3, US-370, spec §7 "Catálogo"): o exame do catálogo em três áreas — dados (nome, unidade, outros nomes e
 * "Exames que compõem este"), "Faixas do consultório" (uma linha editável por faixa, "Acrescentar faixa"/"Remover faixa")
 * e "Modelos de nota de interpretação" (linha fixa e o aviso de dados do paciente). Erros por campo (`role="alert"`,
 * ligados por `aria-describedby`); depois de um erro, o formulário volta com o que foi digitado (`valores`, `key`).
 */
export function ExameCatalogoForm({ acao, inicial }: { acao: (s: ExameCatalogoState, fd: FormData) => Promise<ExameCatalogoState>; inicial: ExameDoFormulario }) {
  const [state, action, pendente] = useActionState(acao, {});
  const valores = state.valores ? formularioDosValores(state.valores) : inicial;
  return (
    <form action={action} noValidate className="space-y-6">
      <Campos key={state.envio ?? 0} inicial={valores} erros={state.erros ?? {}} />
      {state.erros?.geral && (
        <p role="alert" className="text-erro">
          {state.erros.geral}
        </p>
      )}
      <Botao type="submit" disabled={pendente}>
        {X.salvar}
      </Botao>
    </form>
  );
}

function AreaDeTexto({ id, rotulo, dica, erro, defaultValue, linhas = 4 }: { id: string; rotulo: string; dica?: string; erro?: string; defaultValue: string; linhas?: number }) {
  const descricao = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {rotulo}
      </label>
      {dica && (
        <p id={`${id}-dica`} className="text-sm text-suave">
          {dica}
        </p>
      )}
      <textarea id={id} name={id} rows={linhas} defaultValue={defaultValue} aria-invalid={erro ? true : undefined} aria-describedby={descricao} className={CAMPO} />
      {erro && (
        <p id={`${id}-erro`} role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

let proxima = 0;
const comChave = (f: FaixaDoFormulario) => ({ ...f, chave: ++proxima });

function Campos({ inicial, erros }: { inicial: ExameDoFormulario; erros: Record<string, string> }) {
  const [faixas, setFaixas] = useState(() => inicial.faixas.map(comChave));
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo id="nome" rotulo={X.nome} required defaultValue={inicial.nome} erro={erros.nome} />
        <Campo id="unidade" rotulo={X.unidade} defaultValue={inicial.unidade} erro={erros.unidade} />
        <AreaDeTexto id="sinonimos" rotulo={X.sinonimos} dica={X.ajudaSinonimos} defaultValue={inicial.sinonimos} erro={erros.sinonimos} />
        <AreaDeTexto id="componentes" rotulo={X.componentes} dica={X.ajudaComponentes} defaultValue={inicial.componentes} erro={erros.componentes} />
      </div>

      <section aria-labelledby="faixas-titulo" data-guia="faixas-consultorio" className="space-y-3 rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="faixas-titulo" className="font-titulo text-lg font-semibold">
          {F.titulo}
        </h2>
        <p className="text-suave">{F.ajuda}</p>
        {erros.faixas && (
          <p role="alert" className="text-erro">
            {erros.faixas}
          </p>
        )}
        <ol className="space-y-4">
          {faixas.map((f, i) => (
            <LinhaDaFaixa key={f.chave} i={i} faixa={f} erros={erros} aoRemover={() => setFaixas((fs) => fs.filter((x) => x.chave !== f.chave))} />
          ))}
        </ol>
        <Botao type="button" variante="secundario" onClick={() => setFaixas((fs) => [...fs, comChave(faixaVazia())])}>
          {F.acrescentar}
        </Botao>
      </section>

      <section aria-labelledby="modelos-nota-titulo" data-guia="modelos-nota" className="space-y-3 rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="modelos-nota-titulo" className="font-titulo text-lg font-semibold">
          {N.titulo}
        </h2>
        <p className="font-medium">{N.linhaFixa}</p>
        <Aviso tipo="aviso" papel="nenhum">
          {N.aviso}
        </Aviso>
        <AreaDeTexto id="modeloNotaAbaixo" rotulo={N.abaixo} defaultValue={inicial.modeloNotaAbaixo} erro={erros.modeloNotaAbaixo} />
        <AreaDeTexto id="modeloNotaAcima" rotulo={N.acima} defaultValue={inicial.modeloNotaAcima} erro={erros.modeloNotaAcima} />
      </section>
    </>
  );
}

/** Uma faixa: grupo nomeado "Faixa {n}", campos com id por posição (`faixas-<i>-<campo>`) e nome `faixas.<i>.<campo>`. */
function LinhaDaFaixa({ i, faixa, erros, aoRemover }: { i: number; faixa: FaixaDoFormulario; erros: Record<string, string>; aoRemover: () => void }) {
  const id = (c: CampoDaFaixa) => `faixas-${i}-${c}`;
  const nome = (c: CampoDaFaixa) => `faixas.${i}.${c}`;
  const erro = (c: CampoDaFaixa) => erros[`faixas.${i}.${c}`];
  const descr = (c: CampoDaFaixa, extra?: string) => [extra, erro(c) ? `${id(c)}-erro` : null].filter(Boolean).join(' ') || undefined;
  const msgErro = (c: CampoDaFaixa) =>
    erro(c) && (
      <p id={`${id(c)}-erro`} role="alert" className="text-sm text-erro">
        {erro(c)}
      </p>
    );
  const numero = (c: CampoDaFaixa, rotulo: string, modo: 'numeric' | 'decimal') => (
    <div className="space-y-1">
      <label htmlFor={id(c)} className="block font-medium">
        {rotulo}
      </label>
      <input id={id(c)} name={nome(c)} inputMode={modo} defaultValue={faixa[c]} aria-invalid={erro(c) ? true : undefined} aria-describedby={descr(c)} className={CAMPO} />
      {msgErro(c)}
    </div>
  );
  const titulo = MSG_EXAMES.faixas.rotuloFaixa(i + 1);
  return (
    <li>
      <fieldset className="space-y-3 rounded-2xl border border-borda p-4">
        <legend className="px-1 font-semibold">{titulo}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor={id('sexo')} className="block font-medium">
              {F.sexo}
            </label>
            <select key={faixa.sexo} id={id('sexo')} name={nome('sexo')} defaultValue={faixa.sexo} aria-invalid={erro('sexo') ? true : undefined} aria-describedby={descr('sexo')} className={CAMPO}>
              <option value="todos">{F.sexos.todos}</option>
              <option value="F">{F.sexos.F}</option>
              <option value="M">{F.sexos.M}</option>
            </select>
            {msgErro('sexo')}
          </div>
          {numero('idadeMin', `${F.idadeDe} (${F.anos})`, 'numeric')}
          {numero('idadeMax', `${F.ate} (${F.anos})`, 'numeric')}
          {numero('aPartirDe', F.aPartirDe, 'decimal')}
          {numero('abaixoDe', F.abaixoDe, 'decimal')}
          <div className="space-y-1">
            <label htmlFor={id('categoria')} className="block font-medium">
              {F.categoria}
            </label>
            <select key={faixa.categoria} id={id('categoria')} name={nome('categoria')} defaultValue={faixa.categoria} aria-invalid={erro('categoria') ? true : undefined} aria-describedby={descr('categoria')} className={CAMPO}>
              <option value="">{F.escolha}</option>
              {CATEGORIAS_DO_CONSULTORIO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {msgErro('categoria')}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor={id('fonte')} className="block font-medium">
              {F.fonte}
            </label>
            <p id={`${id('fonte')}-dica`} className="text-sm text-suave">
              {F.ajudaFonte}
            </p>
            <input id={id('fonte')} name={nome('fonte')} defaultValue={faixa.fonte} aria-invalid={erro('fonte') ? true : undefined} aria-describedby={descr('fonte', `${id('fonte')}-dica`)} className={CAMPO} />
            {msgErro('fonte')}
          </div>
        </div>
        {faixa.atualizadaEm && (
          <p className="text-sm text-suave">
            {F.fonteDe(faixa.fonte)} · {F.atualizadaEm(formatarData(faixa.atualizadaEm))}
          </p>
        )}
        <Botao type="button" variante="secundario" aria-label={MSG_EXAMES.faixas.removerRotulo(i + 1)} onClick={aoRemover}>
          {F.remover}
        </Botao>
      </fieldset>
    </li>
  );
}
