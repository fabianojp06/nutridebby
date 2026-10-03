import { eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { session, tenants, user } from '@/db/schema';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { ContaNaoEncontradaError } from './tenant-status';

/** US-004 / P05-06: o worker troca os lembretes do tenant (o admin nunca toca tabela 🔒, CLAUDE.md regra 1). */
async function avisarAgenda(tx: Tx, tenantId: string, evento: 'suspenso' | 'reativado') {
  const id = await (await getBoss()).send('agenda-tenant', { tenantId, evento }, { db: fromDrizzle(tx, sql) });
  if (!id) throw new Error('A fila da agenda recusou o envio');
}

/**
 * US-004 / RN-15: suspende sem apagar nada e revoga na mesma transação as sessões das
 * usuárias do tenant. Pacientes (Plano 03+) são barrados por vínculo em requireUser (Plano 06).
 */
export async function suspenderConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<{ sessoesRevogadas: number }> {
  return db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ status: 'suspensa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new ContaNaoEncontradaError();
    await avisarAgenda(tx, tenantId, 'suspenso'); // RN-15: os lembretes pendentes viram "ignorada" no worker
    const apagadas = await tx
      .delete(session)
      .where(inArray(session.userId, tx.select({ id: user.id }).from(user).where(eq(user.tenantId, tenantId))))
      .returning({ id: session.id });
    logger.info({ tenantId, adminId, sessoesRevogadas: apagadas.length }, 'conta suspensa');
    return { sessoesRevogadas: apagadas.length };
  });
}

export async function reativarConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ status: 'ativa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new ContaNaoEncontradaError();
    await avisarAgenda(tx, tenantId, 'reativado'); // RN-05: lembretes das consultas futuras reagendados
  });
  logger.info({ tenantId, adminId }, 'conta reativada');
}
