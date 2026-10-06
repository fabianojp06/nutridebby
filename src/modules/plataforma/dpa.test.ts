import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { consents, tenants, user } from '@/db/schema';
import { IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { registrarAceiteAditivoIa, registrarAceiteDpa } from './dpa';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/**
 * drizzle-orm 0.45 envolve erros do driver em `DrizzleQueryError`, cuja `.message` é só
 * "Failed query: ...". A mensagem real do Postgres fica em `error.cause` (mesmo padrão de
 * src/db/tenant.test.ts).
 */
async function rejectionCause(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { cause?: { message?: string }; message?: string };
    return err.cause?.message ?? err.message ?? '';
  }
  throw new Error('esperava que a Promise fosse rejeitada');
}

async function tenantComNutri() {
  const [t] = await app.db.insert(tenants).values({ slug: `dpa-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Tenant DPA' }).returning();
  const userId = randomUUID();
  await app.db.insert(user).values({
    id: userId,
    name: 'Nutri DPA',
    email: `dpa-${randomUUID().slice(0, 8)}@exemplo.com`,
    appRole: 'nutri',
    tenantId: t.id,
  });
  return { tenantId: t.id, userId };
}

describe('registrarAceiteDpa (T6-R2b)', () => {
  it('reaceitar a mesma versão não grava consents de novo nem adianta tenants.dpa_aceito_em', async () => {
    const { tenantId, userId } = await tenantComNutri();
    const t1 = new Date('2026-10-01T10:00:00Z');
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: '203.0.113.1', now: t1 });

    const t2 = new Date('2026-10-05T10:00:00Z');
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: '203.0.113.2', now: t2 });

    const linhas = await app.db.select().from(consents).where(eq(consents.userId, userId));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].aceitoEm.toISOString()).toBe(t1.toISOString());
    expect(linhas[0].ip).toBe('203.0.113.1');

    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant.dpaAceitoEm?.toISOString()).toBe(t1.toISOString());
  });
});

describe('consents é prova de aceite (T6-R2c)', () => {
  it('o role da aplicação não pode alterar nem apagar um consentimento', async () => {
    const { tenantId, userId } = await tenantComNutri();
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: null, now: new Date('2026-10-01T10:00:00Z') });

    const updateMsg = await rejectionCause(app.db.execute(sql`update consents set ip = 'x' where user_id = ${userId}`));
    expect(updateMsg).toMatch(/permission denied/);
    const deleteMsg = await rejectionCause(app.db.execute(sql`delete from consents where user_id = ${userId}`));
    expect(deleteMsg).toMatch(/permission denied/);

    const linhas = await app.db.select().from(consents).where(eq(consents.userId, userId));
    expect(linhas).toHaveLength(1);
  });
});

it('Plano 11 (A-D20): o aceite do aditivo de IA não mexe no DPA e grava o consultório no consents', async () => {
  const T = await novoTenant(app.db);
  await registrarAceiteAditivoIa(app.db, { userId: T.nutriId, tenantId: T.tenantId, ip: null, now: new Date('2026-10-06T12:00:00Z') });
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  expect(t).toMatchObject({ dpaVersao: null, iaAditivoVersao: IA_ADITIVO_VERSAO });
  const [c] = await app.db.select().from(consents).where(and(eq(consents.userId, T.nutriId), eq(consents.termoVersao, IA_ADITIVO_TERMO)));
  expect(c).toMatchObject({ tenantId: T.tenantId, patientId: null });
});
