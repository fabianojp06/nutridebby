import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';

export type TenantStatus = 'ativa' | 'suspensa';

export async function getTenantStatus(db: Db, tenantId: string): Promise<TenantStatus | null> {
  const [row] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
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
