import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { logger } from '@/lib/logger';
import { dataValida } from '@/modules/pacientes/datas';
import { ContaNaoEncontradaError } from './tenant-status';

export type MetricasTenant = {
  tenantId: string;
  arquivos: number;
  armazenamentoBytes: number;
  pacientesAtivos: number | null;
  consultasMes: number | null;
  mensagensWhatsappMes: number | null;
};

const n = (v: string | number | null) => (v === null ? null : Number(v));

/** §3 / §4.1: só contagens, vindas da função SECURITY DEFINER. */
export async function metricasPorTenant(db: Db = getDb()): Promise<Map<string, MetricasTenant>> {
  const r = await db.execute<{
    tenant_id: string; arquivos: string; armazenamento_bytes: string;
    pacientes_ativos: string | null; consultas_mes: string | null; mensagens_whatsapp_mes: string | null;
  }>(sql`select * from admin_tenant_metrics()`);
  return new Map(
    r.rows.map((x) => [
      x.tenant_id,
      {
        tenantId: x.tenant_id,
        arquivos: Number(x.arquivos),
        armazenamentoBytes: Number(x.armazenamento_bytes),
        pacientesAtivos: n(x.pacientes_ativos),
        consultasMes: n(x.consultas_mes),
        mensagensWhatsappMes: n(x.mensagens_whatsapp_mes),
      },
    ]),
  );
}

export type MetricasSucessoTenant = { comConta: number; abriram: number; faltasMes: number; iniciadasMes: number };

/** D15: CS-02 e CS-03 por tenant, só contagens (função SECURITY DEFINER, 0087). */
export async function metricasDeSucessoPorTenant(db: Db = getDb()): Promise<Map<string, MetricasSucessoTenant>> {
  const r = await db.execute<{ tenant_id: string; pacientes_com_conta: string; abriram_7_dias: string; faltas_mes: string; iniciadas_mes: string }>(
    sql`select * from admin_metricas_sucesso()`,
  );
  return new Map(
    r.rows.map((x) => [x.tenant_id, { comConta: Number(x.pacientes_com_conta), abriram: Number(x.abriram_7_dias), faltasMes: Number(x.faltas_mes), iniciadasMes: Number(x.iniciadas_mes) }]),
  );
}

export const MSG_COTA_WA = 'Informe um número inteiro de 0 a 100000';
const cotaSchema = z.string().trim().regex(/^\d{1,6}$/, MSG_COTA_WA).transform(Number).pipe(z.number().max(100_000, MSG_COTA_WA));

export class CotaWhatsappError extends Error {
  override name = 'CotaWhatsappError';
}

/** §3: o admin ajusta a cota mensal de WhatsApp do tenant (RN-09 usa no Plano 05). */
export async function ajustarCotaWhatsapp(tenantId: string, valor: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = cotaSchema.safeParse(valor);
  if (!r.success) throw new CotaWhatsappError(MSG_COTA_WA);
  const up = await db.update(tenants).set({ waCotaMensal: r.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!up.length) throw new ContaNaoEncontradaError();
  logger.info({ tenantId, adminId, cota: r.data }, 'cota de WhatsApp ajustada');
}

export const MSG_METRICAS = {
  taxa: 'Informe um percentual de 0 a 100',
  data: 'Informe a data no formato dd/mm/aaaa',
} as const;

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

/**
 * D15: o admin grava a base do CS-03 (E-08) e o início do uso (CS-01). `tenants` não tem RLS; o id vem da tela do admin.
 * Fica neste módulo (e não em metricas-sucesso.ts, que tem as leituras da nutricionista) para a guarda
 * sem-tabelas-tenant.test.ts conferir o caminho do admin (regra 1: o admin nunca consulta tabelas 🔒).
 */
export async function salvarMetricasBase(tenantId: string, entrada: { taxaBase: string; goLiveEm: string }, adminId: string, db: Db = getDb()): Promise<void> {
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
  logger.info({ tenantId, adminId }, 'métricas de sucesso ajustadas');
}
