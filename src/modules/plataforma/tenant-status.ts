import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';

export type TenantStatus = 'ativa' | 'suspensa';

/**
 * `aguardarSuspensao` (M8): `FOR SHARE` espera uma suspensão em curso (UPDATE ainda sem COMMIT)
 * terminar e devolve o status já confirmado, em vez do anterior.
 */
export async function getTenantStatus(db: Db, tenantId: string, opts: { aguardarSuspensao?: boolean } = {}): Promise<TenantStatus | null> {
  const q = db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  const [row] = opts.aguardarSuspensao ? await q.for('share') : await q;
  return (row?.status as TenantStatus | undefined) ?? null;
}

/** T6-R2: `tenants` não tem tenant_id — só serviços de src/modules/plataforma a consultam. */
export async function buscarTenant(db: Db, tenantId: string): Promise<TenantRow | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return row ?? null;
}

/** RN-15: jobs de um tenant suspenso não enviam nada. Tenant inexistente conta como inativo. */
export async function tenantIsActive(db: Db, tenantId: string): Promise<boolean> {
  return (await getTenantStatus(db, tenantId)) === 'ativa';
}
