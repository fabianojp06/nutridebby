import { eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { session, tenants, user } from '@/db/schema';
import { logger } from '@/lib/logger';
import { ContaNaoEncontradaError } from './tenant-status';

/**
 * US-004 / RN-15: suspende sem apagar nada e revoga na mesma transação as sessões das
 * usuárias do tenant. Pacientes (Plano 03+) são barrados por vínculo em requireUser (Plano 06).
 */
export async function suspenderConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<{ sessoesRevogadas: number }> {
  return db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ status: 'suspensa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new ContaNaoEncontradaError();
    const apagadas = await tx
      .delete(session)
      .where(inArray(session.userId, tx.select({ id: user.id }).from(user).where(eq(user.tenantId, tenantId))))
      .returning({ id: session.id });
    logger.info({ tenantId, adminId, sessoesRevogadas: apagadas.length }, 'conta suspensa');
    return { sessoesRevogadas: apagadas.length };
  });
}

export async function reativarConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = await db.update(tenants).set({ status: 'ativa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!r.length) throw new ContaNaoEncontradaError();
  logger.info({ tenantId, adminId }, 'conta reativada');
  // P05-06: reagendar os lembretes das consultas futuras (RN-05) quando a tabela notifications existir
}
