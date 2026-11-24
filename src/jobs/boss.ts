import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { getServerEnv } from '@/env';
import { camposDoErro, logger } from '@/lib/logger';
import { ensureQueues } from './queues';

// globalThis: o `next dev` recarrega módulos; sem isso cada HMR abriria outra instância
const g = globalThis as unknown as { __ndBoss?: Promise<PgBoss>; __ndBossPool?: Pool };

/**
 * Instância só de envio (app Next.js, scripts e testes): não supervisiona nem agenda nada — isso é do worker.
 * Revisão 2 da T12: pool PRÓPRIO e pequeno (2 conexões, o mesmo DATABASE_URL), nunca o do app. Quem envia dentro de uma
 * transação (dispararEnvio, webhook, suspensão, e-mail com `tx`) segura uma conexão do app enquanto espera o getBoss; com
 * o produtor no pool do app, dez envios assim logo depois de um deploy ocupavam as 10 conexões e o `start` do pg-boss
 * esperava atrás deles para sempre (o app inteiro parava). Os envios com `db: fromDrizzle(tx, sql)` continuam na
 * transação de quem chama.
 */
export function getBoss(): Promise<PgBoss> {
  return (g.__ndBoss ??= (async () => {
    const pool = (g.__ndBossPool ??= new Pool({ connectionString: getServerEnv().DATABASE_URL, max: 2 }));
    const boss = new PgBoss({
      db: { executeSql: (text, values) => pool.query(text, values as unknown[]) },
      schema: 'pgboss',
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => logger.error(camposDoErro(err), 'pg-boss (produtor) erro')); // regra 3: nunca o erro cru
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch(async (err: unknown) => {
    g.__ndBoss = undefined;
    const pool = g.__ndBossPool;
    g.__ndBossPool = undefined;
    await pool?.end().catch(() => undefined);
    throw err;
  }));
}

/** O worker registra a própria instância (com supervisão e pool próprio) para os envios feitos dentro dele. */
export function useBoss(boss: PgBoss): void {
  g.__ndBoss = Promise.resolve(boss);
}

export async function stopBoss(): Promise<void> {
  const p = g.__ndBoss;
  const pool = g.__ndBossPool;
  g.__ndBoss = undefined;
  g.__ndBossPool = undefined;
  try {
    if (p) await (await p).stop({ graceful: false });
  } finally {
    await pool?.end();
  }
}
