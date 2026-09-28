import { PgBoss } from 'pg-boss';
import { getPool } from '@/db/client';
import { logger } from '@/lib/logger';
import { ensureQueues } from './queues';

// globalThis: o `next dev` recarrega módulos; sem isso cada HMR abriria outra instância
const g = globalThis as unknown as { __ndBoss?: Promise<PgBoss> };

/**
 * Instância só de envio (app Next.js, scripts e testes): usa o pool da aplicação e não
 * supervisiona nem agenda nada — isso é do worker.
 */
export function getBoss(): Promise<PgBoss> {
  return (g.__ndBoss ??= (async () => {
    const pool = getPool();
    const boss = new PgBoss({
      db: { executeSql: (text, values) => pool.query(text, values as unknown[]) },
      schema: 'pgboss',
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => logger.error({ err }, 'pg-boss (produtor) erro'));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch((err: unknown) => {
    g.__ndBoss = undefined;
    throw err;
  }));
}

/** O worker registra a própria instância (com supervisão) para os envios feitos dentro dele. */
export function useBoss(boss: PgBoss): void {
  g.__ndBoss = Promise.resolve(boss);
}

export async function stopBoss(): Promise<void> {
  const p = g.__ndBoss;
  g.__ndBoss = undefined;
  if (p) await (await p).stop({ graceful: false });
}
