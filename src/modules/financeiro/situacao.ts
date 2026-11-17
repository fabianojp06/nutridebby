import type { TipoLancamento } from '@/db/schema/financeiro';
import { MSG_FINANCEIRO } from './constantes';

/** RN-305 / F-D4: a situação é calculada, nunca gravada. */
export type Situacao = 'cancelado' | 'recebido' | 'pago' | 'em_atraso' | 'previsto';

export const ROTULO_SITUACAO: Record<Situacao, string> = MSG_FINANCEIRO.situacoes;

/**
 * RN-305: cancelado → recebido/pago → vencido **antes** de hoje → previsto (vence hoje ou depois). `hoje` é sempre
 * `hojeNoFuso(tenant.fuso)`; datas 'AAAA-MM-DD' comparam como texto.
 */
export function situacaoDoLancamento(
  l: { tipo: TipoLancamento; vencimento: string; pagoEm: string | null; canceladoEm: Date | null },
  hoje: string,
): Situacao {
  if (l.canceladoEm) return 'cancelado';
  if (l.pagoEm) return l.tipo === 'entrada' ? 'recebido' : 'pago';
  return l.vencimento < hoje ? 'em_atraso' : 'previsto';
}

/** RN-306: recebido/pago conta pela data do pagamento; em aberto, pelo vencimento. */
export function dataDeReferencia(l: { vencimento: string; pagoEm: string | null }): string {
  return l.pagoEm ?? l.vencimento;
}
