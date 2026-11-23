import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { receitaPorPaciente } from '@/modules/financeiro/resumo';
import { fecharLeitura, prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import { RANKING_LIMITE, type RankingPor } from './constantes';
import type { Periodo } from './periodo';
import type { LinhaRanking, RelRanking } from './tipos';

/**
 * US-485 (RN-492), só da nutricionista (RE-D36): até 20 pacientes `ativo` ou `arquivado`, não anonimizados. "Mais
 * consultas" = consultas `realizada` no período (`appointments_inicio_idx`), `limit` no SQL, empate pelo nome exibido sem
 * diferença de acento e maiúsculas (`app_unaccent(lower(…))`, RE-D68), depois pelo id. "Maior receita" só pela função do
 * módulo do Financeiro (`receitaPorPaciente`, RN-491). Devolve o id e os dois nomes (o exibido na tela; o de registro no
 * CSV e na impressão) e o número — nada mais do paciente. A tela não chama `auditRead` (RN-493: como a lista de
 * pacientes); quem exporta grava um `exportar` por paciente da lista devolvida, na
 * transação da leitura (`deps.naMesmaTransacao` = `exportacaoNaLeitura`).
 */
export async function relatorioRanking(
  ctx: TenantContext,
  tenant: TenantRel,
  p: Periodo,
  o: OpcoesRel & { por: RankingPor },
  deps: DepsRel<RelRanking> = {},
): Promise<RelRanking> {
  const lim = prepararSecao(ctx, tenant, 'ranking', p, o);
  if (o.por !== 'consultas' && o.por !== 'receita') throw new RangeError('relatorios: critério do ranking inválido');
  return withTenant(
    ctx,
    async (tx): Promise<RelRanking> => {
      if (o.por === 'receita') {
        return fecharLeitura(tx, { por: o.por, linhas: await receitaPorPaciente(tx, ctx.tenantId, p, { limite: RANKING_LIMITE }) }, deps);
      }
      const { rows } = await tx.execute<LinhaRanking>(sql`
        select p.id as "patientId", coalesce(pc.nome_social, p.nome) as "nomeExibido", p.nome as "nomeRegistro", count(*)::int as "valor"
        from appointments a
        join patients p on p.tenant_id = a.tenant_id and p.id = a.patient_id
        left join patient_cadastro pc on pc.tenant_id = p.tenant_id and pc.patient_id = p.id
        where a.tenant_id = ${ctx.tenantId} and a.status = 'realizada' and a.inicio >= ${lim.inicio} and a.inicio < ${lim.fim}
          and p.status in ('ativo', 'arquivado') and p.anonimizado_em is null
        group by p.id, p.nome, pc.nome_social
        order by count(*) desc, app_unaccent(lower(coalesce(pc.nome_social, p.nome))), p.id
        limit ${RANKING_LIMITE}`);
      return fecharLeitura(tx, { por: o.por, linhas: rows }, deps);
    },
    deps.db ?? getDb(),
  );
}
