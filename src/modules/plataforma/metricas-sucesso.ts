import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { accessEvents, appointments, consultations, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { dataValida, hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { ContaNaoEncontradaError } from './tenant-status';

export const META_CS02 = 0.6;
export const DIAS_CS01 = 30;
export const MSG_METRICAS = {
  taxa: 'Informe um percentual de 0 a 100',
  data: 'Informe a data no formato dd/mm/aaaa',
} as const;

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
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const inicioJanela = somarDias(hoje, -6);
  const desde = tenant.goLiveEm;
  return withTenant(
    ctx,
    async (tx) => {
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
    },
    db,
  );
}

// até duas casas, como a coluna numeric(5,2); vírgula ou ponto (RNF-12)
const taxaSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{1,3}([.,]\d{1,2})?$/.test(v), MSG_METRICAS.taxa)
  .transform((v) => (v === '' ? null : Number(v.replace(',', '.'))))
  .refine((v) => v === null || v <= 100, MSG_METRICAS.taxa);
const dataSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || dataValida(v), MSG_METRICAS.data)
  .transform((v) => (v === '' ? null : v));

/** D15: o admin grava a base do CS-03 (E-08) e o início do uso (CS-01). `tenants` não tem RLS; o id vem da tela do admin. */
export async function salvarMetricasBase(tenantId: string, entrada: { taxaBase: string; goLiveEm: string }, db: Db = getDb()): Promise<void> {
  const taxa = taxaSchema.safeParse(entrada.taxaBase);
  if (!taxa.success) throw new Error(MSG_METRICAS.taxa);
  const data = dataSchema.safeParse(entrada.goLiveEm);
  if (!data.success) throw new Error(MSG_METRICAS.data);
  const up = await db
    .update(tenants)
    .set({ taxaFaltasBase: taxa.data, goLiveEm: data.data, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id });
  if (!up.length) throw new ContaNaoEncontradaError(); // M9, como ajustarCotaWhatsapp
}
