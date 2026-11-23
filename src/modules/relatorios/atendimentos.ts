import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { porMes, prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import type { Periodo } from './periodo';
import type { RelAtendimentos } from './tipos';

/**
 * US-481 (RN-488), numa consulta: os "eventos de atendimento" de cada paciente — consulta `realizada` (pelo dia de
 * `appointments.inicio` no fuso) e atendimento registrado (`consultations.data`) — e o primeiro da vida de cada um (`min`,
 * a regra da RN-416 do Plano 23 agregada por paciente, nunca por item). No mês: pacientes distintos, os que tiveram o
 * primeiro atendimento nele ("novos") e os outros ("retorno"), consultas realizadas e atendimentos registrados. Só ids,
 * datas e o status: nenhuma coluna de conteúdo do atendimento é lida, nenhum `auditRead` (agregado, RN-493). Pacientes
 * anonimizados contam (número sem identificação). Só da nutricionista (RN-480).
 */
export async function relatorioAtendimentos(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel, deps: DepsRel = {}): Promise<RelAtendimentos> {
  const lim = prepararSecao(ctx, tenant, 'atendimentos', p, o);
  return withTenant(
    ctx,
    async (tx) => {
      const { rows } = await tx.execute<{ mes: string; atendidos: number; novos: number; consultas: number; atendimentos: number }>(sql`
        with eventos as (
          select patient_id, (inicio at time zone ${tenant.fuso})::date as dia, true as consulta
          from appointments
          where tenant_id = ${ctx.tenantId} and status = 'realizada'
          union all
          select patient_id, data, false
          from consultations
          where tenant_id = ${ctx.tenantId}
        ),
        primeiro as (select patient_id, min(dia) as dia from eventos group by patient_id)
        select to_char(e.dia, 'YYYY-MM') as mes,
               count(distinct e.patient_id)::int as atendidos,
               count(distinct e.patient_id) filter (where date_trunc('month', pr.dia) = date_trunc('month', e.dia))::int as novos,
               count(*) filter (where e.consulta)::int as consultas,
               count(*) filter (where not e.consulta)::int as atendimentos
        from eventos e
        join primeiro pr on pr.patient_id = e.patient_id
        where e.dia >= ${lim.primeiroDia}::date and e.dia <= ${lim.ultimoDia}::date
        group by 1`);
      return {
        meses: porMes(p.meses, rows, (mes, r) => ({
          mes,
          atendidos: r?.atendidos ?? 0,
          novos: r?.novos ?? 0,
          retorno: (r?.atendidos ?? 0) - (r?.novos ?? 0),
          consultasRealizadas: r?.consultas ?? 0,
          atendimentosRegistrados: r?.atendimentos ?? 0,
        })),
      };
    },
    deps.db ?? getDb(),
  );
}
