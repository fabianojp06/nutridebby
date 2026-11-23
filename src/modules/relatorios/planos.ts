import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { porMes, prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import type { Periodo } from './periodo';
import type { RelPlanos } from './tipos';

/**
 * US-482 (RN-489). Por mês de `publicado_em` no fuso: publicações (cada versão publicada conta, inclusive a que depois foi
 * arquivada por uma versão nova) e pacientes distintos; só planos de paciente (`patient_id` preenchido: modelos fora).
 * Cartão "hoje": pacientes ativos (não anonimizados) com algum plano `publicado` (o `meal_plans_um_publicado_idx`), de
 * todos os ativos. Lê só `publicado_em`, `patient_id` e `status`: nenhuma coluna de conteúdo do plano, nenhum `auditRead`.
 * O filtro de local não se aplica (US-482). Só da nutricionista (RN-480).
 */
export async function relatorioPlanos(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel, deps: DepsRel = {}): Promise<RelPlanos> {
  const lim = prepararSecao(ctx, tenant, 'planos', p, o);
  return withTenant(
    ctx,
    async (tx) => {
      const { rows } = await tx.execute<{ mes: string; publicacoes: number; pacientes: number }>(sql`
        select mes, count(*)::int as publicacoes, count(distinct patient_id)::int as pacientes
        from (
          select to_char(publicado_em at time zone ${tenant.fuso}, 'YYYY-MM') as mes, patient_id
          from meal_plans
          where tenant_id = ${ctx.tenantId} and patient_id is not null
            and publicado_em >= ${lim.inicio} and publicado_em < ${lim.fim}
        ) x
        group by mes`);
      const {
        rows: [hoje],
      } = await tx.execute<{ ativos: number; com_plano: number }>(sql`
        select count(*)::int as ativos,
               count(*) filter (where exists (
                 select 1 from meal_plans m
                 where m.tenant_id = p.tenant_id and m.patient_id = p.id and m.status = 'publicado'
               ))::int as com_plano
        from patients p
        where p.tenant_id = ${ctx.tenantId} and p.status = 'ativo' and p.anonimizado_em is null`);
      return {
        meses: porMes(p.meses, rows, (mes, r) => ({ mes, publicacoes: r?.publicacoes ?? 0, pacientes: r?.pacientes ?? 0 })),
        hoje: { comPlano: hoje.com_plano, ativos: hoje.ativos },
      };
    },
    deps.db ?? getDb(),
  );
}
