import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { fecharLeitura, porMes, prepararSecao, type DepsRel, type OpcoesRel, type TenantRel } from './comum';
import type { Periodo } from './periodo';
import type { LinhaAgenda, RelAgenda } from './tipos';

/**
 * US-483 (RN-490), numa consulta a `appointments` (pelo `appointments_inicio_idx`), por mês de `inicio` no fuso:
 * - "Marcadas" = não canceladas e não `solicitada` (o pedido do paciente ainda sem resposta não é consulta marcada; Plano 23,
 *   RN-423, como as métricas do admin na 0131; code review do PR 1), o mesmo "Consultas do mês" do Início
 *   (`indicadoresDaAgendaNaTransacao`, CS-482) — o Início ainda conta `solicitada` e o 23 o alinha;
 * - "Faltas" e "iniciadas" (não canceladas com `inicio` até agora) dão a "Taxa de faltas" com a conta do Início
 *   (`taxaDeFaltas`, formatada pela tela com `textoTaxa`);
 * - canceladas pelo paciente e pelo consultório (`nutri`); as do `sistema` (exclusão LGPD) em coluna nenhuma;
 * - "Marcadas pelo paciente" = `origem = 'paciente'`, não canceladas;
 * - "Retornos" = marcadas de paciente que já tinha consulta realizada antes do `inicio` ou atendimento registrado em dia
 *   anterior (RN-488; a primeira consulta da vida não conta), por `exists` nos índices por paciente
 *   (`appointments_paciente_idx`, `consultations_paciente_data_idx`).
 * Nenhum nome, nenhum `auditRead`. O que depende do Plano 23 (`solicitada`, pedidos, previsões) entra na T11a; na sessão
 * da recepção, "Retornos" virá da função `SECURITY DEFINER` do PR 2 (RN-510, T11b).
 */
export async function relatorioAgenda(ctx: TenantContext, tenant: TenantRel, p: Periodo, o: OpcoesRel, deps: DepsRel<RelAgenda> = {}): Promise<RelAgenda> {
  const lim = prepararSecao(ctx, tenant, 'agenda', p, o);
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const { rows } = await tx.execute<Omit<LinhaAgenda, 'retornosPrevistos' | 'previstosComConsulta'>>(sql`
        select mes,
               count(*) filter (where ativa)::int as "marcadas",
               count(*) filter (where status = 'realizada')::int as "realizadas",
               count(*) filter (where status = 'faltou')::int as "faltas",
               count(*) filter (where ativa and inicio <= ${agora})::int as "iniciadas",
               count(*) filter (where status = 'cancelada' and cancelado_por = 'paciente')::int as "canceladasPaciente",
               count(*) filter (where status = 'cancelada' and cancelado_por = 'nutri')::int as "canceladasConsultorio",
               count(*) filter (where ativa and origem = 'paciente')::int as "marcadasPeloPaciente",
               count(*) filter (where retorno)::int as "retornos"
        from (
          select to_char(a.inicio at time zone ${tenant.fuso}, 'YYYY-MM') as mes, a.status, a.cancelado_por, a.origem, a.inicio,
                 a.status not in ('cancelada', 'solicitada') as ativa,
                 case when a.status in ('cancelada', 'solicitada') then false else (
                   exists (
                     select 1 from appointments b
                     where b.tenant_id = a.tenant_id and b.patient_id = a.patient_id and b.status = 'realizada' and b.inicio < a.inicio
                   ) or exists (
                     select 1 from consultations c
                     where c.tenant_id = a.tenant_id and c.patient_id = a.patient_id and c.data < (a.inicio at time zone ${tenant.fuso})::date
                   )
                 ) end as retorno
          from appointments a
          where a.tenant_id = ${ctx.tenantId} and a.inicio >= ${lim.inicio} and a.inicio < ${lim.fim}
        ) x
        group by mes`);
      const zero = { marcadas: 0, realizadas: 0, faltas: 0, iniciadas: 0, canceladasPaciente: 0, canceladasConsultorio: 0, marcadasPeloPaciente: 0, retornos: 0 };
      return fecharLeitura(tx, { meses: porMes(p.meses, rows, (mes, r) => ({ ...zero, ...r, mes })) }, deps);
    },
    deps.db ?? getDb(),
  );
}

/** A taxa do Início (faltas ÷ não canceladas já iniciadas); sem iniciada, sem taxa (a tela mostra "Sem dados"). */
export function taxaDeFaltas(l: Pick<LinhaAgenda, 'faltas' | 'iniciadas'>): number | null {
  return l.iniciadas ? l.faltas / l.iniciadas : null;
}
