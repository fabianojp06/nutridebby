import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { auditLog, tenants } from './schema';
import { TenantContextError, withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
let A: string;
let B: string;

/**
 * drizzle-orm 0.45 envolve erros do driver em `DrizzleQueryError`, cuja
 * `.message` é só "Failed query: ...". A mensagem real do Postgres
 * (ex.: "row-level security", "permission denied") fica em `error.cause`.
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

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Tenant A' },
      { slug: `b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Tenant B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  for (const t of [A, B]) {
    await withTenant({ tenantId: t, role: 'nutri' }, (tx) =>
      tx.insert(auditLog).values({ tenantId: t, acao: 'criar', entidade: 'teste' }),
      app.db,
    );
  }
});
afterAll(() => app.pool.end());

describe('withTenant', () => {
  it('só enxerga registros do próprio tenant', async () => {
    const rows = await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.select().from(auditLog), app.db);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === A)).toBe(true);
  });

  it('recusa inserir registro com tenant_id de outro tenant', async () => {
    const msg = await rejectionCause(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
        tx.insert(auditLog).values({ tenantId: B, acao: 'criar', entidade: 'teste' }), app.db),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it('fora de withTenant, a mesma conexão do pool não vê nada (Review Focus 1)', async () => {
    const client = await app.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [A]);
      await client.query('commit');
      const { rows } = await client.query('select count(*)::int as n from audit_log');
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('audit_log não aceita UPDATE nem DELETE pelo role da aplicação', async () => {
    const updateMsg = await rejectionCause(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
        tx.execute(sql`update audit_log set acao = 'ler'`), app.db),
    );
    expect(updateMsg).toMatch(/permission denied/);
    const deleteMsg = await rejectionCause(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) => tx.execute(sql`delete from audit_log`), app.db),
    );
    expect(deleteMsg).toMatch(/permission denied/);
  });

  it('valida o contexto antes de tocar no banco', async () => {
    await expect(withTenant({ tenantId: 'x', role: 'nutri' }, async () => 1, app.db)).rejects.toBeInstanceOf(TenantContextError);
    await expect(withTenant({ tenantId: A, role: 'paciente' }, async () => 1, app.db)).rejects.toThrow(/patientId/);
    await expect(
      withTenant({ tenantId: A, role: 'nutri', patientId: randomUUID() }, async () => 1, app.db),
    ).rejects.toThrow(/patientId/);
  });

  it('sessão de paciente só vê as próprias linhas (política RESTRICTIVE)', async () => {
    const P1 = randomUUID();
    const P2 = randomUUID();
    await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.execute(sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto)
        values (${A}, ${P1}, 'p1'), (${A}, ${P2}, 'p2')`), app.db);
    const seen = await withTenant({ tenantId: A, role: 'paciente', patientId: P1 }, (tx) =>
      tx.execute<{ patient_id: string }>(sql`select patient_id from rls_fixture_patient_items`), app.db);
    expect(seen.rows.map((r) => r.patient_id)).toEqual([P1]);
    const nutriSees = await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.execute(sql`select 1 from rls_fixture_patient_items where patient_id in (${P1}, ${P2})`), app.db);
    expect(nutriSees.rows.length).toBe(2);
  });

  it('aplica ator e IP do contexto para a auditoria', async () => {
    const actor = randomUUID();
    const r = await withTenant({ tenantId: A, role: 'nutri', actorUserId: actor, ip: '203.0.113.5' }, (tx) =>
      tx.execute<{ u: string; ip: string }>(sql`select app_current_user()::text as u, app_current_ip() as ip`), app.db);
    expect(r.rows[0]).toEqual({ u: actor, ip: '203.0.113.5' });
    const semAtor = await withTenant({ tenantId: A, role: 'worker' }, (tx) =>
      tx.execute<{ u: string | null }>(sql`select app_current_user()::text as u`), app.db);
    expect(semAtor.rows[0].u).toBeNull();
  });

  it("papel 'publico' (página pública e horários livres, D11): sem paciente, sem ator; com patientId é recusado", async () => {
    const r = await withTenant({ tenantId: A, role: 'publico' }, (tx) => tx.execute<{ r: string }>(sql`select app_current_role() as r`), app.db);
    expect(r.rows[0].r).toBe('publico');
    await expect(withTenant({ tenantId: A, role: 'publico', patientId: randomUUID() }, async () => 1, app.db)).rejects.toThrow(/patientId/);
  });

  it('recusa papel fora da lista, ator que não é uuid e IP inválido (item adiado do Plano 01)', async () => {
    await expect(withTenant({ tenantId: A, role: 'admin' as never }, async () => 1, app.db)).rejects.toThrow(/papel/);
    await expect(withTenant({ tenantId: A, role: 'nutri', actorUserId: 'x' }, async () => 1, app.db)).rejects.toThrow(/actorUserId/);
    await expect(withTenant({ tenantId: A, role: 'nutri', ip: '999.1.1.1' }, async () => 1, app.db)).rejects.toThrow(/ip/);
  });
});
