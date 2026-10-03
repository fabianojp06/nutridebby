import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { consents } from '@/db/schema';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';

/**
 * US-011 "Nova versão do termo": a conta já aceitou a versão atual NESTE consultório? `consents` fica fora da RLS
 * (RLS_EXCEPTIONS): filtra sempre pela conta e pelo tenant (CLAUDE.md regra 1).
 */
export async function termoAceito(userId: string, tenantId: string, db: Db = getDb()): Promise<boolean> {
  const [c] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.tenantId, tenantId), eq(consents.termoVersao, TERMO_PACIENTE)))
    .limit(1);
  return Boolean(c);
}

/** Grava o aceite da versão atual (prova de aceite: só INSERT; repetir não duplica — UNIQUE NULLS NOT DISTINCT). */
export async function aceitarTermo(o: { userId: string; tenantId: string; ip: string | null }, db: Db = getDb()): Promise<void> {
  await db.insert(consents).values({ userId: o.userId, tenantId: o.tenantId, termoVersao: TERMO_PACIENTE, ip: o.ip }).onConflictDoNothing();
}
