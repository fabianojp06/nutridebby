import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { accessEvents, appointments, consultations, patients, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';

export const META_CS02 = 0.6;
export const DIAS_CS01 = 30;

export type MetricasSucesso = {
  cs01: { desde: string | null; dias: number; realizadas: number; comAtendimento: number };
  cs02: { comConta: number; abriram: number; porDia: { dia: string; n: number }[] };
  cs03: { base: number | null };
};

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/**
 * §1.1 (D15): só contagens, sem auditRead (não devolve dado de saúde de ninguém — como a lista de pacientes). Uma
 * transação. CS-03 usa `indicadoresDaAgenda` (já no Início) + a base informada pelo admin.
 */
export async function metricasDeSucesso(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fuso' | 'goLiveEm' | 'taxaFaltasBase'>,
  agora: Date,
  db: Db = getDb(),
): Promise<MetricasSucesso> {
  return withTenant(ctx, (tx) => metricasDeSucessoNaTransacao(tx, tenant, agora), db);
}

export async function metricasDeSucessoNaTransacao(tx: Tx, tenant: Pick<TenantRow, 'fuso' | 'goLiveEm' | 'taxaFaltasBase'>, agora: Date): Promise<MetricasSucesso> {
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const inicioJanela = somarDias(hoje, -6);
  const desde = tenant.goLiveEm;
  const [c1] = desde
    ? await tx
        .select({
          realizadas: sql<number>`count(*) filter (where ${appointments.status} = 'realizada')`.mapWith(Number),
          comAtendimento: sql<number>`count(${consultations.id}) filter (where ${appointments.status} = 'realizada')`.mapWith(Number),
        })
        .from(appointments)
        // join, não `exists` correlacionado: num select de uma tabela só o Drizzle não qualifica as colunas, e o
        // `"id"` de dentro do subselect seria o da própria consultations. No máximo um atendimento por consulta (0064).
        .leftJoin(consultations, eq(consultations.appointmentId, appointments.id))
        .where(and(gte(appointments.inicio, inicioDoDia(desde, tenant.fuso)), lt(appointments.inicio, agora)))
    : [{ realizadas: 0, comAtendimento: 0 }];
  // a mesma população no número, no total e nas barras: paciente ativo, com conta e não anonimizado
  const populacaoCs02 = and(eq(patients.status, 'ativo'), isNotNull(patients.userId), isNull(patients.anonimizadoEm));
  const [c2] = await tx
    .select({
      comConta: sql<number>`count(distinct ${patients.id})`.mapWith(Number),
      abriram: sql<number>`count(distinct ${accessEvents.patientId})`.mapWith(Number),
    })
    .from(patients)
    .leftJoin(accessEvents, and(eq(accessEvents.patientId, patients.id), gte(accessEvents.dia, inicioJanela)))
    .where(populacaoCs02);
  const linhas = await tx
    .select({ dia: accessEvents.dia, n: count() })
    .from(accessEvents)
    .innerJoin(patients, eq(patients.id, accessEvents.patientId))
    .where(and(gte(accessEvents.dia, inicioJanela), populacaoCs02))
    .groupBy(accessEvents.dia);
  const porDia = Array.from({ length: 7 }, (_, i) => somarDias(inicioJanela, i)).map((dia) => ({ dia, n: linhas.find((l) => l.dia === dia)?.n ?? 0 }));
  return {
    cs01: { desde, dias: desde ? Math.max(0, diasEntre(desde, hoje) + 1) : 0, realizadas: c1.realizadas, comAtendimento: c1.comAtendimento },
    cs02: { comConta: c2.comConta, abriram: c2.abriram, porDia },
    cs03: { base: tenant.taxaFaltasBase },
  };
}
