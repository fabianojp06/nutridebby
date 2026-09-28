import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants } from '@/db/schema';

export type TenantStatus = 'ativa' | 'suspensa';

export async function getTenantStatus(db: Db, tenantId: string): Promise<TenantStatus | null> {
  const [row] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  return (row?.status as TenantStatus | undefined) ?? null;
}

/** RN-15: jobs de um tenant suspenso não enviam nada. Tenant inexistente conta como inativo. */
export async function tenantIsActive(db: Db, tenantId: string): Promise<boolean> {
  return (await getTenantStatus(db, tenantId)) === 'ativa';
}
