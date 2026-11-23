'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import type { TipoLancamento } from '@/db/schema/financeiro';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import {
  criarLancamentoAction,
  editarLancamentoAction,
  type CampoDoLancamento,
  type LancamentoState,
} from './actions';
import { OpcoesDeForma, Selecao } from './comum';
import { useFocoNoErro } from './receber';

const M = MSG_FINANCEIRO;
/** A opção "sem paciente" do seletor (fora da §6.2: aguarda a aprovação do dono com os outros textos novos). */
const SEM_PACIENTE = 'Nenhum';

type Props = {
  tipo: TipoLancamento;
  /** Na edição: o lançamento (o formulário chama `editarLancamentoAction`; tipo e paciente ficam fora, RN-308). */
  id?: string;
  /** Ativas do tipo (e a atual, mesmo arquivada, na edição). */
  categorias: { id: string; nome: string }[];
  /** Só no novo lançamento de entrada (F-D28: ativos e arquivados, sem bloqueados). */
  pacientes?: { id: string; nome: string; arquivado: boolean }[];
  inicial: Record<CampoDoLancamento, string>;
  /** A data sugerida ao marcar "Já foi recebido/pago" (hoje no fuso do consultório). */
  hoje: string;
  /** Edição com o paciente bloqueado (RN-315): só o valor; categoria, vencimento e descrição como texto. */
  bloqueado?: { categoria: string; vencimento: string; descricao: string };
};

/**
 * US-301 / US-302: o formulário do lançamento. `noValidate`: as mensagens são as do módulo, junto do campo
 * (`role="alert"`, `aria-describedby`). Depois de um erro o formulário remonta (`key`) com o que foi digitado (`valores`) —
 * no React 19 os campos não controlados voltam ao padrão depois da action — e o foco vai ao primeiro campo com erro.
 */
export function FormLancamento(props: Props) {
  const [state, action, pendente] = useActionState<LancamentoState, FormData>(
    props.id ? editarLancamentoAction : criarLancamentoAction,
    {},
  );
  const form = useFocoNoErro(state);
  return (
    <form
      ref={form}
      key={state.envio}
      action={action}
      noValidate
      data-guia="financeiro-novo"
      className="max-w-2xl space-y-4 rounded-3xl border border-borda bg-cartao p-5"
    >
      <Campos {...props} state={state} pendente={pendente} />
    </form>
  );
}

/** O corpo do formulário: remonta com ele, e o "Já foi recebido/pago" volta ao que foi enviado. */
function Campos({
  tipo,
  id,
  categorias,
  pacientes,
  inicial,
  hoje,
  bloqueado,
  state,
  pendente,
}: Props & { state: LancamentoState; pendente: boolean }) {
  const v = { ...inicial, ...state.valores };
  const e = state.erros ?? {};
  const [jaFoi, setJaFoi] = useState(v.jaFoi === 'on');
  const ajudaDescricao = M.ajudaDescricao[tipo];
  return (
    <>
      {id && <input type="hidden" name="id" value={id} />}
      {!id && <input type="hidden" name="tipo" value={tipo} />}
      {pacientes && (
        <Selecao
          id="pacienteId"
          rotulo={M.campos.paciente}
          defaultValue={v.pacienteId}
          erro={e.pacienteId}
        >
          <option value="">{SEM_PACIENTE}</option>
          {pacientes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.arquivado ? `${p.nome} ${M.campos.arquivado}` : p.nome}
            </option>
          ))}
        </Selecao>
      )}
      <div className="sm:max-w-xs">
        <Campo
          id="valor"
          rotulo={M.campos.valor}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={v.valor}
          erro={e.valor}
        />
      </div>
      {bloqueado ? (
        <>
          {/* RN-315: o que não muda vai como estava (o módulo e o gatilho recusam qualquer diferença) */}
          {(['categoriaId', 'vencimento', 'descricao', 'jaFoi', 'pagoEm', 'forma'] as const).map(
            (c) => (
              <input key={c} type="hidden" name={c} value={v[c]} />
            ),
          )}
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">{M.campos.categoria}</dt>
            <dd>{bloqueado.categoria}</dd>
            <dt className="font-medium">{M.campos.vencimento}</dt>
            <dd>{bloqueado.vencimento}</dd>
            {bloqueado.descricao && (
              <>
                <dt className="font-medium">{M.csv.colunas.descricao}</dt>
                <dd className="min-w-0 wrap-break-word">{bloqueado.descricao}</dd>
              </>
            )}
          </dl>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Selecao
              id="categoriaId"
              rotulo={M.campos.categoria}
              defaultValue={v.categoriaId}
              erro={e.categoriaId}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
            <Campo
              id="vencimento"
              rotulo={M.campos.vencimento}
              type="date"
              defaultValue={v.vencimento}
              erro={e.vencimento}
            />
          </div>
          <Campo
            id="descricao"
            rotulo={M.campos.descricao}
            autoComplete="off"
            defaultValue={v.descricao}
            erro={e.descricao}
            dica={ajudaDescricao}
          />
          <div className="flex min-h-11 items-center gap-2">
            <input
              id="jaFoi"
              name="jaFoi"
              type="checkbox"
              defaultChecked={jaFoi}
              onChange={(ev) => setJaFoi(ev.target.checked)}
              className="size-5"
            />
            <label htmlFor="jaFoi">{M.campos.jaFoi[tipo]}</label>
          </div>
          {jaFoi && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                id="pagoEm"
                rotulo={M.campos.dataDoPagamento[tipo]}
                type="date"
                defaultValue={v.pagoEm || hoje}
                erro={e.pagoEm}
              />
              <Selecao id="forma" rotulo={M.campos.forma} defaultValue={v.forma} erro={e.forma}>
                <OpcoesDeForma />
              </Selecao>
            </div>
          )}
        </>
      )}
      {e.geral && (
        <p role="alert" tabIndex={-1} data-erro-geral="" className="text-erro">
          {e.geral}
        </p>
      )}
      <Botao disabled={pendente}>{tipo === 'entrada' ? M.salvarEntrada : M.salvarSaida}</Botao>
    </>
  );
}
