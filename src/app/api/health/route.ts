import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';
import { evaluateHealth } from '@/worker/heartbeat';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  let heartbeatLido = false;
  let lastBeat: Date | null = null;
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    dbOk = true;
    const [row] = await db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'worker'));
    lastBeat = row?.beatAt ?? null;
    heartbeatLido = true;
  } catch {
    // dbOk diz qual das duas leituras falhou (N5); getDb() fica dentro do try (R13)
  }
  const result = evaluateHealth({ dbOk, heartbeatLido, lastBeat, now: new Date() });
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
