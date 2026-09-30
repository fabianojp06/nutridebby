import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';

export const HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

export async function recordHeartbeat(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .insert(systemHeartbeat)
    .values({ name: 'worker', beatAt: now })
    .onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: sql`excluded.beat_at` } });
}

export function evaluateHealth(i: { dbOk: boolean; lastBeat: Date | null; now: Date }): {
  status: 'ok' | 'degradado';
  reason?: string;
} {
  if (!i.dbOk) return { status: 'degradado', reason: 'banco indisponível' };
  if (!i.lastBeat) return { status: 'degradado', reason: 'worker sem heartbeat' };
  if (i.now.getTime() - i.lastBeat.getTime() > HEARTBEAT_MAX_AGE_MS) {
    return { status: 'degradado', reason: 'worker sem heartbeat há mais de 10 min' };
  }
  return { status: 'ok' };
}
