import { PgBoss } from 'pg-boss';
import { closeDb, getDb } from '@/db/client';
import { getServerEnv } from '@/env';
import { logger } from '@/lib/logger';
import { recordHeartbeat } from './heartbeat';

export async function startWorker(connectionString: string): Promise<() => Promise<void>> {
  // createSchema: false — o schema `pgboss` já existe (criado e possuído pelo
  // role de login da app na migration, ver src/db/migrate.ts). Sem isso, o
  // `CREATE SCHEMA IF NOT EXISTS` do pg-boss falha com "permission denied for
  // database" porque esse comando exige o privilégio CREATE no banco mesmo
  // quando o schema já existe — privilégio que o role da app não tem (e não
  // deveria precisar, já que é dono do schema).
  const boss = new PgBoss({ connectionString, schema: 'pgboss', createSchema: false });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss erro'));
  await boss.start();

  await boss.createQueue('heartbeat', { retryLimit: 0, expireInSeconds: 60 });
  await boss.schedule('heartbeat', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('heartbeat', async () => {
    await recordHeartbeat(getDb());
  });

  await recordHeartbeat(getDb()); // batida imediata ao subir
  logger.info('worker iniciado');
  return async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await closeDb();
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = await startWorker(getServerEnv().DATABASE_URL);
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
