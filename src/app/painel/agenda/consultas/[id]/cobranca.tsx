'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import { MSG_FINANCEIRO as M } from '@/modules/financeiro/constantes';
import { formatarReais, valorParaCampo } from '@/modules/financeiro/dinheiro';
import type { LancamentoNaTela } from '@/modules/financeiro/tipos';
import { formatarData } from '@/modules/pacientes/datas';
import type { LancamentoState } from '../../../financeiro/lancamentos/actions';
import { Cancelar } from '../../../financeiro/lancamentos/cancelar';
import { ErroGeral } from '../../../financeiro/lancamentos/comum';
import { Receber, useFocoNoErro, type AcaoDoLancamento } from '../../../financeiro/lancamentos/receber';
import { cancelarCobrancaAction, receberCobrancaAction, registrarCobrancaAction, salvarValorCobrancaAction } from './cobranca-actions';

const LINK = 'text-link underline';
const CONFIGURACOES = '/painel/financeiro/configuracoes';

type Props = {
  consultaId: string;
  cobranca: LancamentoNaTela | null;
  motivo: 'nao_configurado' | 'bloqueado' | 'nao_realizada' | null;
  valorSugerido: number | null;
  /** Hoje no fuso do consultório (a data sugerida do recebimento). */
  hoje: string;
};

/**
 * A seção "Cobrança" da tela da consulta (US-303, §7): só em consulta "Realizada", ou "Faltou" com cobrança (a página
 * decide). Com cobrança: "{valor} · {situação}" (recebida: "{valor} · Recebido em {data} · {forma}") e "Abrir no
 * Financeiro"; em aberto, também "Salvar valor", "Marcar como recebido" e "Cancelar lançamento". Sem cobrança: "Esta
 * consulta não tem cobrança." e "Registrar cobrança" (RN-314), ou o porquê de não poder.
 */
export function SecaoCobranca({ consultaId, cobranca: l, motivo, valorSugerido, hoje }: Props) {
  return (
    <section aria-labelledby="cobranca" className="space-y-2">
      <h2 id="cobranca" className="text-lg font-semibold">{M.consulta.titulo}</h2>
      {l ? <ComCobranca consultaId={consultaId} l={l} hoje={hoje} /> : <SemCobranca consultaId={consultaId} motivo={motivo} valorSugerido={valorSugerido} />}
    </section>
  );
}

function ComCobranca({ consultaId, l, hoje }: { consultaId: string; l: LancamentoNaTela; hoje: string }) {
  const valor = formatarReais(l.valorCentavos);
  const situacao = l.pagoEm && l.forma ? M.consulta.recebidoEm(formatarData(l.pagoEm), M.formas[l.forma]) : M.situacoes[l.situacao];
  const aberta = !l.pagoEm && !l.anonimizado && l.situacao !== 'cancelado';
  const volta = `/painel/agenda/consultas/${consultaId}`;
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-4">
        <span>{M.consulta.valorESituacao(valor, situacao)}</span>
        <Link href={`/painel/financeiro/lancamentos/${l.id}`} className={`inline-flex min-h-11 items-center ${LINK}`}>
          {M.consulta.abrir}
        </Link>
      </p>
      {l.paciente?.bloqueado && <p>{M.bloqueado}</p>}
      {aberta && (
        <>
          <FormValor acao={salvarValorCobrancaAction.bind(null, consultaId)} botao={M.consulta.salvarValor} inicial={valorParaCampo(l.valorCentavos)} lancamentoId={l.id} />
          <div className="-mx-2 flex max-w-2xl flex-wrap items-center">
            <Receber id={l.id} tipo={l.tipo} recebido={false} hoje={hoje} volta={volta} acao={receberCobrancaAction.bind(null, consultaId)} />
            <Cancelar id={l.id} volta={volta} acao={cancelarCobrancaAction.bind(null, consultaId)} />
          </div>
        </>
      )}
    </>
  );
}

function SemCobranca({ consultaId, motivo, valorSugerido }: { consultaId: string; motivo: Props['motivo']; valorSugerido: number | null }) {
  return (
    <>
      <p>{M.consulta.semCobranca}</p>
      {motivo === null && (
        <FormValor acao={registrarCobrancaAction.bind(null, consultaId)} botao={M.consulta.registrar} inicial={valorSugerido === null ? '' : valorParaCampo(valorSugerido)} />
      )}
      {motivo === 'nao_configurado' && (
        <p>
          <Link href={CONFIGURACOES} className={LINK}>
            {M.consulta.configure.link}
          </Link>
          {M.consulta.configure.depois}
        </p>
      )}
      {motivo === 'bloqueado' && <p>{M.consulta.bloqueado}</p>}
    </>
  );
}

/** "Valor" + o botão ("Salvar valor" ou "Registrar cobrança"); o erro junto do campo, com o digitado de volta. */
function FormValor({ acao, botao, inicial, lancamentoId }: { acao: AcaoDoLancamento; botao: string; inicial: string; lancamentoId?: string }) {
  const [state, action, pendente] = useActionState<LancamentoState, FormData>(acao, {});
  const form = useFocoNoErro(state);
  const e = state.erros ?? {};
  const id = lancamentoId ? 'cobranca-valor' : 'cobranca-nova-valor';
  return (
    <form ref={form} key={state.envio} action={action} noValidate className="flex max-w-2xl flex-wrap items-end gap-3">
      {lancamentoId && <input type="hidden" name="id" value={lancamentoId} />}
      <div className="sm:max-w-xs">
        <Campo id={id} name="valor" rotulo={M.campos.valor} inputMode="decimal" autoComplete="off" defaultValue={state.valores?.valor ?? inicial} erro={e.valor} />
      </div>
      <Botao variante="secundario" disabled={pendente}>
        {botao}
      </Botao>
      {e.geral && (
        <span className="basis-full">
          <ErroGeral texto={e.geral} />
        </span>
      )}
    </form>
  );
}
