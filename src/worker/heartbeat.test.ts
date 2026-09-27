import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { systemHeartbeat } from '@/db/schema';
import { evaluateHealth, HEARTBEAT_MAX_AGE_MS, recordHeartbeat } from './heartbeat';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const now = new Date('2026-10-01T12:00:00Z');

describe('heartbeat e health (RNF-04)', () => {
  it('ok com banco no ar e heartbeat recente', () => {
    expect(evaluateHealth({ dbOk: true, lastBeat: new Date(now.getTime() - 60_000), now })).toEqual(
      { status: 'ok' },
    );
  });
  it('degradado com heartbeat mais velho que 10 min', () => {
    expect(
      evaluateHealth({
        dbOk: true,
        lastBeat: new Date(now.getTime() - HEARTBEAT_MAX_AGE_MS - 1),
        now,
      }),
    ).toEqual({ status: 'degradado', reason: 'worker sem heartbeat há mais de 10 min' });
  });
  it('degradado sem nenhum heartbeat', () => {
    expect(evaluateHealth({ dbOk: true, lastBeat: null, now })).toEqual({
      status: 'degradado',
      reason: 'worker sem heartbeat',
    });
  });
  it('degradado com banco fora do ar', () => {
    expect(evaluateHealth({ dbOk: false, lastBeat: now, now })).toEqual({
      status: 'degradado',
      reason: 'banco indisponível',
    });
  });
  it('recordHeartbeat grava e atualiza a linha do worker', async () => {
    await recordHeartbeat(app.db, now);
    await recordHeartbeat(app.db, new Date(now.getTime() + 60_000));
    const [row] = await app.db
      .select()
      .from(systemHeartbeat)
      .where(eq(systemHeartbeat.name, 'worker'));
    expect(row.beatAt.toISOString()).toBe('2026-10-01T12:01:00.000Z');
  });
});
