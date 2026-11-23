import type { FormaPagamento, TipoLancamento } from '@/db/schema/financeiro';
import type { Situacao } from './situacao';

/**
 * Tipos compartilhados do Financeiro (Plano 20). Ficam aqui para as funções puras (T2) não dependerem das de banco
 * (T3, T4), que importam daqui. Valores sempre em centavos inteiros; datas 'AAAA-MM-DD'; meses 'AAAA-MM'.
 */

/**
 * Uma linha do CSV dos lançamentos (RN-321). `paciente` é o nome civil e vem preenchido sempre que o lançamento tem
 * paciente: sem "Incluir o nome dos pacientes", `csvLancamentos` tira a coluna e esvazia a descrição dessas linhas.
 */
export type LinhaCsv = {
  vencimento: string;
  pagoEm: string | null;
  tipo: TipoLancamento;
  categoria: string;
  descricao: string | null;
  paciente: string | null;
  forma: FormaPagamento | null;
  valorCentavos: number;
  situacao: Situacao;
};

/** Uma linha de categoria do fluxo de caixa: 12 valores, de janeiro a dezembro. */
export type LinhaFluxo = { categoria: string; valores: number[] };

/**
 * Fluxo de caixa do ano (US-306): cada lista tem 12 posições, na ordem de `meses`. `saldoInicio`/`saldoFim` são nulos
 * antes do mês do saldo do caixa (e `saldoInicio` também no próprio mês do saldo); `saldoDesde` é a data do saldo.
 */
export type FluxoDoAno = {
  ano: number;
  meses: string[];
  categoriasEntrada: LinhaFluxo[];
  categoriasSaida: LinhaFluxo[];
  totalEntradas: number[];
  totalSaidas: number[];
  resultado: number[];
  saldoInicio: (number | null)[];
  saldoFim: (number | null)[];
  saldoDesde: string | null;
};

/** As opções do filtro "Situação" da lista (spec §6.2): recebido e pago num valor só. */
export type SituacaoDoFiltro = 'previsto' | 'em_atraso' | 'recebido_ou_pago' | 'cancelado';

/** Filtros da lista (RN-306; spec §4.1: `?mes=&tipo=&categoria=&situacao=&forma=&paciente=`). */
export type FiltrosLista = {
  mes?: string;
  tipo?: TipoLancamento;
  situacao?: SituacaoDoFiltro;
  categoriaId?: string;
  forma?: FormaPagamento;
  pacienteId?: string;
};

/** Os totais da lista, sem os cancelados (os mesmos critérios do Resumo). */
export type TotaisDaLista = { entradas: { recebido: number; aReceber: number }; saidas: { pago: number; aPagar: number } };

export type LancamentoNaTela = {
  id: string;
  tipo: TipoLancamento;
  categoria: { id: string; nome: string };
  valorCentavos: number;
  vencimento: string;
  pagoEm: string | null;
  forma: FormaPagamento | null;
  descricao: string | null;
  /** `bloqueado` não inclui o anonimizado (TRI-17-20 #130: o aviso de cada um é outro). */
  paciente: { id: string; nome: string; bloqueado: boolean; anonimizado: boolean } | null;
  consulta: { id: string; inicio: Date } | null;
  situacao: Situacao;
  canceladoEm: Date | null;
  motivoCancelamento: string | null;
  anonimizado: boolean;
};
