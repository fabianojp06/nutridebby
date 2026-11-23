import type { Db } from '@/db/client';
import type { TenantContext } from '@/db/tenant';
import { intervaloDoMes } from '@/modules/financeiro/meses';
import { exigirSecao, type Acesso } from './acesso';
import { MESES_MAX, type Secao } from './constantes';
import { limitesDoMes, type Periodo } from './periodo';

/**
 * Plano 26, T2: o que as seis leituras dos Relatórios fazem igual **antes** de abrir a transação (Global Constraints) —
 * conferem a seção (`exigirSecao`), o filtro de local e o período — e os limites do período no fuso do consultório.
 */
export type TenantRel = { fuso: string };
export type DepsRel = { db?: Db; agora?: Date };
export type OpcoesRel = { localId: string | null; acesso: Acesso };

export type Limites = {
  /** Do 1º dia de `de` às 00:00 ao 1º dia do mês seguinte a `ate` às 00:00 (exclusivo), no fuso (colunas `timestamptz`). */
  inicio: Date;
  fim: Date;
  /** O 1º e o último dia do período, 'AAAA-MM-DD' (colunas `date`: `consultations.data`, `fin_lancamentos.pago_em`). */
  primeiroDia: string;
  ultimoDia: string;
};

/**
 * RN-480 + RN-481. O filtro de local (RN-482) é da Fase B, com o Plano 23 na `main` (T11a): até lá não existe
 * `locais_atendimento`, e um `localId` preenchido é erro de programação (a tela só o passa com o 23) — nunca ignorado em
 * silêncio, que mostraria o consultório inteiro com o nome de um local. Período fora do formato ou com mais de 12 meses
 * (a tela confere antes, `periodoDaUrl`): RangeError.
 */
export function prepararSecao(ctx: TenantContext, tenant: TenantRel, secao: Secao, p: Periodo, o: OpcoesRel): Limites {
  exigirSecao(ctx, o.acesso, secao);
  if (o.localId !== null) throw new RangeError('relatorios: o filtro de local só existe com o Plano 23');
  const n = p.meses.length;
  if (n < 1 || n > MESES_MAX || p.meses[0] !== p.de || p.meses[n - 1] !== p.ate) throw new RangeError('relatorios: período inválido');
  return {
    inicio: limitesDoMes(p.de, tenant.fuso).inicio,
    fim: limitesDoMes(p.ate, tenant.fuso).fim,
    primeiroDia: intervaloDoMes(p.de).de,
    ultimoDia: intervaloDoMes(p.ate).ate,
  };
}

/** Uma linha por mês do período, na ordem, com zero onde o SQL não devolveu nada. */
export function porMes<R extends { mes: string }, T>(meses: readonly string[], linhas: R[], linha: (mes: string, r: R | undefined) => T): T[] {
  const doMes = new Map(linhas.map((r) => [r.mes, r]));
  return meses.map((mes) => linha(mes, doMes.get(mes)));
}
