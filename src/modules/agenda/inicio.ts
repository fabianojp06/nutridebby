import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { accessEvents, appointments, diaryEntries } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { listarAgenda, STATUS_ATIVOS, type Consulta } from './consultas';
import { inicioDoDia } from './fuso';

export type ResumoDoDia = {
  proxima: { consulta: Consulta; numero: number; diario7d: number; portal7d: number } | null;
  hoje: { total: number; confirmadas: number; pedidosRemarcacao: number };
  agenda: Consulta[];
};

/**
 * Início (D22): a agenda de hoje (como a leitura da agenda, sem auditRead — D10 do Plano 05) e, da próxima consulta, só
 * contagens (registros no diário e dias no portal em 7 dias). Nada de peso nem de outro dado clínico.
 */
export async function resumoDoDia(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<ResumoDoDia> {
  const hoje = hojeNoFuso(fuso, agora);
  const agenda = (await listarAgenda(ctx, inicioDoDia(hoje, fuso), inicioDoDia(somarDias(hoje, 1), fuso), db)).filter((c) => c.status !== 'cancelada');
  const resumo = {
    total: agenda.length,
    confirmadas: agenda.filter((c) => c.status === 'confirmada').length,
    pedidosRemarcacao: agenda.filter((c) => c.pedidoRemarcacaoEm !== null).length,
  };
  const consulta = agenda.find((c) => c.fim.getTime() > agora.getTime() && STATUS_ATIVOS.includes(c.status)) ?? null;
  if (!consulta) return { proxima: null, hoje: resumo, agenda };
  const desde = somarDias(hoje, -6);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ numero: string; diario: string; portal: string }>(sql`select
        (select count(*) from ${appointments} where ${appointments.patientId} = ${consulta.patientId} and ${appointments.status} <> 'cancelada' and ${appointments.inicio} <= ${consulta.inicio}) as numero,
        (select count(*) from ${diaryEntries} where ${diaryEntries.patientId} = ${consulta.patientId} and ${diaryEntries.dataHora} >= ${inicioDoDia(desde, fuso)}) as diario,
        (select count(*) from ${accessEvents} where ${accessEvents.patientId} = ${consulta.patientId} and ${accessEvents.dia} >= ${desde}) as portal`),
    db,
  );
  const [x] = r.rows;
  return { proxima: { consulta, numero: Number(x.numero), diario7d: Number(x.diario), portal7d: Number(x.portal) }, hoje: resumo, agenda };
}
