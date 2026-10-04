import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';
import { logger } from '@/lib/logger';
import { motivoDoErro } from '@/modules/plataforma/armazenamento';
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
  } catch (err) {
    // dbOk diz qual das duas leituras falhou (N5); getDb() fica dentro do try (R13). No log, só o código (SQLSTATE do pg,
    // que o Drizzle embrulha em `cause`; ECONNREFUSED…), nunca a mensagem, que traz a consulta e os parâmetros (RNF-11):
    // um 42501 no heartbeat depois de uma migration com o role errado (regra 7) explica o alerta "heartbeat ilegível".
    const causa = err instanceof Error && err.cause ? err.cause : err;
    logger.warn({ motivo: motivoDoErro(causa), leitura: dbOk ? 'heartbeat' : 'banco' }, 'health: leitura do banco falhou');
  }
  const result = evaluateHealth({ dbOk, heartbeatLido, lastBeat, now: new Date() });
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
