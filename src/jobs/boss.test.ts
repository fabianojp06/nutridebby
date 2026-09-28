import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
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
});
