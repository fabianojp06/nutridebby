import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { logger } from '@/lib/logger';
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
