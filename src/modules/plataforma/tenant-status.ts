import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';

export type TenantStatus = 'ativa' | 'suspensa';

export const MSG_CONTA_NAO_ENCONTRADA = 'Conta não encontrada.';

/** M9: ação do admin sobre um tenant que não existe (aviso próprio em vez da página de erro). */
export class ContaNaoEncontradaError extends Error {
  override name = 'ContaNaoEncontradaError';
  constructor() {
    super(MSG_CONTA_NAO_ENCONTRADA);
  }
}

/** G9: status de uma linha de `tenants` já lida (a restrição `tenants_status_valido` garante o valor); `null` sem linha. */
export function statusDe(tenant: { status: string } | null | undefined): TenantStatus | null {
  return (tenant?.status as TenantStatus | undefined) ?? null;
}

/**
 * `aguardarSuspensao` (M8): `FOR SHARE` espera uma suspensão em curso (UPDATE ainda sem COMMIT)
 * terminar e devolve o status já confirmado, em vez do anterior.
 */
export async function getTenantStatus(db: Db, tenantId: string, opts: { aguardarSuspensao?: boolean } = {}): Promise<TenantStatus | null> {
  const q = db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  const [row] = opts.aguardarSuspensao ? await q.for('share') : await q;
  return statusDe(row);
}

/** T6-R2: `tenants` não tem tenant_id — só serviços de src/modules/plataforma a consultam. */
export async function buscarTenant(db: Db, tenantId: string): Promise<TenantRow | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return row ?? null;
}

/**
 * Plano 05 (página pública /n/<slug>, E2E): o tenant pelo endereço. `tenants` não tem tenant_id nem RLS — só serviços de
 * src/modules/plataforma a leem (CLAUDE.md regra 1). Formato inválido (tenants_slug_formato) → null sem consultar.
 */
export async function buscarTenantPorSlug(db: Db, slug: string): Promise<TenantRow | null> {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return row ?? null;
}

/** RN-15: jobs de um tenant suspenso não enviam nada. Tenant inexistente conta como inativo. */
export async function tenantIsActive(db: Db, tenantId: string): Promise<boolean> {
  return (await getTenantStatus(db, tenantId)) === 'ativa';
}

/** §4.1: varreduras do worker entre tenants partem de `tenants` (inclusive suspensos: obrigação legal não para). */
export async function listarTenantsParaVarredura(db: Db): Promise<{ id: string; fuso: string }[]> {
  return db.select({ id: tenants.id, fuso: tenants.fuso }).from(tenants);
}
