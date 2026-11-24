import type { TenantContext } from '@/db/tenant';
import { relatorioAgenda } from './agenda';
import { relatorioAtendimentos } from './atendimentos';
import type { DepsRel, OpcoesRel, TenantRel } from './comum';
import type { RankingPor, Secao } from './constantes';
import { relatorioFinanceiro } from './financeiro';
import { relatorioPacientes } from './pacientes';
import type { Periodo } from './periodo';
import { relatorioPlanos } from './planos';
import { relatorioRanking } from './ranking';
import type { DadosDaSecao } from './tipos';

/**
 * Plano 26, T3: a leitura de uma seção pelo nome — a tela, a impressão e o CSV chamam por aqui, com o mesmo período, o
 * mesmo acesso e (no CSV e na impressão) o `naMesmaTransacao` que grava o `exportar` (`exportacaoNaLeitura`). Cada
 * `relatorio*` confere a seção antes de abrir a transação (RN-480). `por` só vale para o Ranking.
 */
type Leitor<S extends Secao> = (ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel & { por: RankingPor }, deps: DepsRel<DadosDaSecao[S]>) => Promise<DadosDaSecao[S]>;

const LEITORES: { [S in Secao]: Leitor<S> } = {
  pacientes: relatorioPacientes,
  atendimentos: relatorioAtendimentos,
  planos: relatorioPlanos,
  agenda: relatorioAgenda,
  financeiro: relatorioFinanceiro,
  ranking: relatorioRanking,
};

export function lerSecao<S extends Secao>(
  secao: S,
  ctx: TenantContext,
  tenant: TenantRel,
  p: Periodo,
  o: OpcoesRel & { por: RankingPor },
  deps: DepsRel<DadosDaSecao[S]> = {},
): Promise<DadosDaSecao[S]> {
  return (LEITORES[secao] as Leitor<S>)(ctx, tenant, p, o, deps);
}
