import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';
import { evaluateHealth } from '@/worker/heartbeat';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  let lastBeat: Date | null = null;
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    dbOk = true;
    const [row] = await db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'worker'));
    lastBeat = row?.beatAt ?? null;
  } catch {
    dbOk = false;
  }
  const result = evaluateHealth({ dbOk, lastBeat, now: new Date() });
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
