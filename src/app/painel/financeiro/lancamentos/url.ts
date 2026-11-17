import type { FormaPagamento, TipoLancamento } from '@/db/schema/financeiro';
import { FORMAS_DE_PAGAMENTO } from '@/modules/financeiro/constantes';
import type { SituacaoDoFiltro } from '@/modules/financeiro/tipos';
import { idValido } from '@/modules/pacientes/base';

/**
 * Os filtros da lista na URL (spec §4.1: `?mes=&tipo=&categoria=&situacao=&forma=&paciente=`). Módulo puro: a página lê,
 * os links ("Mês anterior", "Limpar") montam, e as actions de receber e cancelar voltam para a mesma lista.
 */
export const LISTA = '/painel/financeiro/lancamentos';
export const PARAMETROS_DA_LISTA = [
  'mes',
  'tipo',
  'categoria',
  'situacao',
  'forma',
  'paciente',
] as const;
type Parametro = (typeof PARAMETROS_DA_LISTA)[number];
export type FiltrosDaUrl = Partial<Record<Parametro, string>>;

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const SITUACOES: readonly SituacaoDoFiltro[] = [
  'previsto',
  'em_atraso',
  'recebido_ou_pago',
  'cancelado',
];

type Bruto = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/** Só os valores válidos de cada filtro (o resto da URL é ignorado, como em `listarLancamentos`). */
export function filtrosDaUrl(sp: Bruto): {
  mes?: string;
  tipo?: TipoLancamento;
  categoria?: string;
  situacao?: SituacaoDoFiltro;
  forma?: FormaPagamento;
  paciente?: string;
} {
  const tipo = um(sp.tipo);
  const situacao = um(sp.situacao);
  const forma = um(sp.forma);
  const mes = um(sp.mes);
  return {
    mes: mes && MES.test(mes) ? mes : undefined,
    tipo: tipo === 'entrada' || tipo === 'saida' ? tipo : undefined,
    categoria: idValido(um(sp.categoria)) ? um(sp.categoria) : undefined,
    situacao: SITUACOES.find((s) => s === situacao),
    forma: FORMAS_DE_PAGAMENTO.find((f) => f === forma),
    paciente: idValido(um(sp.paciente)) ? um(sp.paciente) : undefined,
  };
}

/** `/painel/financeiro/lancamentos?…` com os filtros dados, na ordem da §4.1 (vazio sai, salvo `mes=` com paciente). */
export function urlDaLista(f: FiltrosDaUrl): string {
  const q = new URLSearchParams();
  for (const k of PARAMETROS_DA_LISTA) {
    const v = f[k];
    if (v || (k === 'mes' && v === '' && f.paciente)) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${LISTA}?${s}` : LISTA;
}

/** O mês `delta` meses antes (negativo) ou depois de 'AAAA-MM'. */
export function mesVizinho(mes: string, delta: number): string {
  const i = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
