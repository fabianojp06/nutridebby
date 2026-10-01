import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { tenants } from '@/db/schema';
import type { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from './sessao';

/** Nutricionista com DPA aceito e cookie de sessão (testes de Route Handler). */
export async function nutriComDpa(db: Db, auth: ReturnType<typeof getAuth>) {
  const [t] = await db.insert(tenants).values({ slug: `pa-${randomUUID().slice(0, 8)}`, nomeExibicao: 'PA' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
