import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { closeDb } from '@/db/client';
import { systemHeartbeat, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { avisarCredencialInvalida, avisarTetoGlobal } from './alertas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.db.delete(systemHeartbeat).where(inArray(systemHeartbeat.name, ['alerta_ia_credencial', 'alerta_ia_teto']));
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('alertas da IA aos admins (RN-105, US-102)', () => {
  it('credencial inválida: no máximo um e-mail por hora; teto global: um por mês', async () => {
    await app.db.insert(user).values({ id: randomUUID(), name: 'Admin IA', email: `admin-ia-${randomUUID().slice(0, 6)}@teste.dev`, appRole: 'admin' });
    const t0 = new Date('2031-03-10T12:00:00Z');
    expect(await avisarCredencialInvalida(app.db, t0, 'https://x')).toBeGreaterThan(0);
    expect(await avisarCredencialInvalida(app.db, new Date(t0.getTime() + 59 * 60_000), 'https://x')).toBe(0);
    expect(await avisarCredencialInvalida(app.db, new Date(t0.getTime() + 61 * 60_000), 'https://x')).toBeGreaterThan(0);
    expect(await avisarTetoGlobal(app.db, t0, 'https://x')).toBeGreaterThan(0);
    expect(await avisarTetoGlobal(app.db, new Date('2031-03-31T20:00:00Z'), 'https://x')).toBe(0);
    expect(await avisarTetoGlobal(app.db, new Date('2031-04-01T12:00:00Z'), 'https://x')).toBeGreaterThan(0);
    const marcas = await app.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'alerta_ia_teto'));
    expect(marcas).toHaveLength(1);
  });
});
