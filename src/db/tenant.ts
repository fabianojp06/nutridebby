import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from './client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantRole = 'nutri' | 'paciente' | 'worker';
export type TenantContext = { tenantId: string; role: TenantRole; patientId?: string };

export class TenantContextError extends Error {
  override name = 'TenantContextError';
}

function assertContext(ctx: TenantContext): void {
  if (!UUID.test(ctx.tenantId)) throw new TenantContextError('tenantId inválido');
  if (ctx.role === 'paciente') {
    if (!ctx.patientId || !UUID.test(ctx.patientId)) {
      throw new TenantContextError('patientId obrigatório para sessão de paciente');
    }
  } else if (ctx.patientId !== undefined) {
    throw new TenantContextError('patientId só é permitido para sessão de paciente');
  }
}

/**
 * Executa `fn` numa transação com o contexto do tenant aplicado à RLS.
 * Toda consulta a tabela com tenant_id DEVE passar por aqui.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  assertContext(ctx);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.role', ${ctx.role}, true),
      set_config('app.patient_id', ${ctx.patientId ?? ''}, true)`);
    return fn(tx);
  });
}
