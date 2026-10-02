import { sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, getPool } from '@/db/client';
import { ensureQueues, QUEUES } from './queues';
import { getBoss, stopBoss } from './boss';

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

describe('fila pg-boss compartilhada (app + worker)', () => {
  it('o produtor do app sobe e cria todas as filas declaradas', async () => {
    const boss = await getBoss();
    for (const name of Object.keys(QUEUES)) expect(await boss.getQueue(name)).not.toBeNull();
  });
  it('ensureQueues é idempotente e aplica a configuração que está no código', async () => {
    const boss = await getBoss();
    await ensureQueues(boss);
    await ensureQueues(boss);
    expect(await boss.getQueue('heartbeat')).toMatchObject({ retryLimit: 0, expireInSeconds: 60 });
  });
  it('getBoss devolve sempre a mesma instância', async () => {
    expect(await getBoss()).toBe(await getBoss());
  });
  it('envia e encontra um job pelo id', async () => {
    const boss = await getBoss();
    const id = await boss.send('heartbeat', { teste: true });
    const [job] = await boss.findJobs<{ teste: boolean }>('heartbeat', { id: id! });
    expect(job.data).toEqual({ teste: true });
  });
  it('revisão 2 da T12: com o produtor frio, transações que ocupam todo o pool do app e esperam o getBoss (como dispararEnvio e o webhook) terminam — o produtor tem pool próprio', async () => {
    await stopBoss(); // produtor frio: logo depois de um deploy, antes de qualquer envio
    const max = getPool().options.max!;
    expect(max).toBe(10);
    const todas = Promise.all(
      Array.from({ length: max }, (_, i) =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql`select 1`); // a conexão do app fica presa nesta transação
          await (await getBoss()).send('heartbeat', { frio: i }, { db: fromDrizzle(tx, sql) });
        }),
      ),
    );
    const espera = (ms: number, v: string) => new Promise<string>((r) => setTimeout(() => r(v), ms));
    const resultado = await Promise.race([todas.then(() => 'terminou'), espera(8_000, 'travou')]);
    if (resultado === 'travou') {
      // sem o conserto: uma conexão a mais no pool do app tira o produtor da fila e as transações terminam — o teste
      // falha com a mensagem certa em vez de prender o arquivo (e o pool volta ao tamanho de antes)
      getPool().options.max = max + 1;
      await Promise.race([getPool().query('select 1'), espera(8_000, 'travou')]);
      await Promise.race([todas.catch(() => undefined), espera(8_000, 'travou')]);
      getPool().options.max = max;
    }
    expect(resultado).toBe('terminou');
  });
});
