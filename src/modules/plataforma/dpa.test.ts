import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { consents, tenants, user } from '@/db/schema';
import { IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { DPA_TERMO, DPA_VERSAO, registrarAceiteAditivoIa, registrarAceiteDpa } from './dpa';

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

describe('Plano 20 (US-309): do DPA 1.0 para o 1.1', () => {
  it('o consultório com o 1.0 aceito grava o aceite do 1.1 numa linha nova; a do 1.0 fica como prova', async () => {
    const { tenantId, userId } = await tenantComNutri();
    const t1 = new Date('2026-10-16T10:00:00Z');
    await app.db.insert(consents).values({ userId, termoVersao: 'dpa-1.0', aceitoEm: t1, ip: '203.0.113.1' });
    await app.db.update(tenants).set({ dpaVersao: '1.0', dpaAceitoEm: t1 }).where(eq(tenants.id, tenantId));

    const t2 = new Date('2026-11-17T10:00:00Z');
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: '203.0.113.2', now: t2 });

    expect([DPA_VERSAO, DPA_TERMO]).toEqual(['1.1', 'dpa-1.1']);
    const linhas = await app.db.select().from(consents).where(eq(consents.userId, userId));
    expect(linhas.map((l) => [l.termoVersao, l.ip, l.aceitoEm.toISOString()]).sort()).toEqual([
      ['dpa-1.0', '203.0.113.1', t1.toISOString()],
      ['dpa-1.1', '203.0.113.2', t2.toISOString()],
    ]);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant).toMatchObject({ dpaVersao: '1.1', dpaAceitoEm: t2 });
  });
});

describe('#153: volta atrás e novo avanço (revisão final do PR 2)', () => {
  it('com dpa-1.1 já em consents e o tenant marcado com a 1.0, o reaceite regrava o tenant sem duplicar a prova', async () => {
    const { tenantId, userId } = await tenantComNutri();
    const t1 = new Date('2026-10-16T10:00:00Z');
    const t2 = new Date('2026-11-17T10:00:00Z');
    await app.db.insert(consents).values([
      { userId, termoVersao: 'dpa-1.0', aceitoEm: t1, ip: '203.0.113.1' },
      { userId, termoVersao: DPA_TERMO, aceitoEm: t2, ip: '203.0.113.2' },
    ]);
    // a correção manual do runbook (financeiro.md §6) depois da volta atrás da imagem
    await app.db.update(tenants).set({ dpaVersao: '1.0', dpaAceitoEm: t1 }).where(eq(tenants.id, tenantId));

    const t3 = new Date('2026-11-20T10:00:00Z');
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: '203.0.113.3', now: t3 });

    const linhas = await app.db.select().from(consents).where(and(eq(consents.userId, userId), eq(consents.termoVersao, DPA_TERMO)));
    expect(linhas.map((l) => [l.ip, l.aceitoEm.toISOString()])).toEqual([['203.0.113.2', t2.toISOString()]]);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
    // a data é a da prova que já existia, nunca a do clique repetido
    expect(tenant).toMatchObject({ dpaVersao: DPA_VERSAO, dpaAceitoEm: t2 });
  });

  it('o reaceite de outra usuária, já com o tenant na versão em vigor, não mexe no tenant', async () => {
    const { tenantId, userId } = await tenantComNutri();
    const t1 = new Date('2026-11-17T10:00:00Z');
    await registrarAceiteDpa(app.db, { userId, tenantId, ip: null, now: t1 });
    const outra = randomUUID();
    await app.db.insert(user).values({ id: outra, name: 'Outra', email: `dpa-${randomUUID().slice(0, 8)}@exemplo.com`, appRole: 'nutri', tenantId });
    const t0 = new Date('2026-11-10T10:00:00Z');
    await app.db.insert(consents).values({ userId: outra, termoVersao: DPA_TERMO, aceitoEm: t0, ip: null });

    await registrarAceiteDpa(app.db, { userId: outra, tenantId, ip: null, now: new Date('2026-11-21T10:00:00Z') });

    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant).toMatchObject({ dpaVersao: DPA_VERSAO, dpaAceitoEm: t1 });
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
  expect(await registrarAceiteAditivoIa(app.db, { userId: T.nutriId, tenantId: T.tenantId, ip: null, now: new Date('2026-10-06T12:00:00Z') })).toBe(true);
  // mesma versão de novo (reativação): não insere outra linha e avisa quem chama (log da ativação, D21)
  expect(await registrarAceiteAditivoIa(app.db, { userId: T.nutriId, tenantId: T.tenantId, ip: null, now: new Date('2026-10-06T12:01:00Z') })).toBe(false);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  expect(t).toMatchObject({ dpaVersao: null, iaAditivoVersao: IA_ADITIVO_VERSAO });
  const [c] = await app.db.select().from(consents).where(and(eq(consents.userId, T.nutriId), eq(consents.termoVersao, IA_ADITIVO_TERMO)));
  expect(c).toMatchObject({ tenantId: T.tenantId, patientId: null });
});
