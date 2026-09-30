import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from './db';
import { tenants } from '@/db/schema';
import { listTenantTables, RLS_EXCEPTIONS } from '@/db/rls-guard';
import { withTenant } from '@/db/tenant';

/**
 * RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant
 * em todas as tabelas 🔒". Cada tabela nova com tenant_id PRECISA de uma fábrica aqui.
 *
 * PF-F3: as fábricas semeiam os DOIS tenants (A e B), cada um com os dois pacientes (P1 e P2),
 * para que o teste falhe tanto se uma política negar tudo (B não veria nem as próprias linhas)
 * quanto se ela liberar tudo (B veria as linhas de A).
 */
const FABRICAS: Record<string, (tenantId: string, patientId: string) => SQL> = {
  audit_log: (t, p) => sql`insert into audit_log (tenant_id, acao, entidade, patient_id) values (${t}, 'ler', 'isolamento', ${p})`,
  stored_files: (t) =>
    sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t}, 'logo', ${`${t}/logo/${randomUUID()}.png`}, 1, 'image/png')`,
  rls_fixture_patient_items: (t, p) => sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  audit_fixture_registros: (t, p) => sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
};
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log']);

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let A: string;
let B: string;
const P1 = randomUUID();
const P2 = randomUUID();
let tabelas: string[] = [];

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `iso-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso A' },
      { slug: `iso-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  tabelas = (await listTenantTables(owner.pool)).filter((t) => !RLS_EXCEPTIONS[t]);
  for (const t of tabelas) {
    if (!FABRICAS[t]) continue;
    for (const tenantId of [A, B]) {
      for (const p of [P1, P2]) await withTenant({ tenantId, role: 'nutri' }, (tx) => tx.execute(FABRICAS[t](tenantId, p)), app.db);
    }
  }
});
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const temPaciente = async (t: string) =>
  (
    await owner.pool.query(
      `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'patient_id'`,
      [t],
    )
  ).rowCount! > 0;

const contarTenant = async (t: string, tenantId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1`, [tenantId])).rows[0].n);

/** Recusa pela política da RLS (WITH CHECK), não por outro motivo qualquer. */
const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

const contarPaciente = async (t: string, tenantId: string, patientId: string) =>
  Number(
    (await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1 and patient_id = $2`, [tenantId, patientId]))
      .rows[0].n,
  );

describe('isolamento em todas as tabelas 🔒 (RNF-07, US-006)', () => {
  it('toda tabela com tenant_id tem fábrica neste teste', () => {
    expect(tabelas.filter((t) => !FABRICAS[t])).toEqual([]);
  });

  // M12: roda antes dos testes que apagam as linhas de B/P2 (o UPDATE precisa de linhas visíveis)
  it('WITH CHECK: o tenant B não grava linha com o tenant_id de A nem move a própria linha para A', async () => {
    for (const t of tabelas) {
      const antesA = await contarTenant(t, A);
      const comoB = (q: SQL) => withTenant({ tenantId: B, role: 'nutri' }, (tx) => tx.execute(q), app.db);
      await expect(comoB(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, B), t).toBeGreaterThan(0); // há linha de B para tentar mover
        await expect(comoB(sql`update ${sql.identifier(t)} set tenant_id = ${A}`), t).rejects.toSatisfy(violaRls);
      }
      expect(await contarTenant(t, A), t).toBe(antesA);
    }
  });

  it('WITH CHECK: a paciente P2 não grava linha de P1 nem move a própria linha para P1', async () => {
    for (const t of tabelas) {
      if (!(await temPaciente(t))) continue;
      const antesP1 = await contarPaciente(t, A, P1);
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      await expect(comoP2(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRls);
      if (!SO_INSERE.has(t)) {
        expect(await contarPaciente(t, A, P2), t).toBeGreaterThan(0);
        await expect(comoP2(sql`update ${sql.identifier(t)} set patient_id = ${P1}`), t).rejects.toSatisfy(violaRls);
      }
      expect(await contarPaciente(t, A, P1), t).toBe(antesP1);
    }
  });

  it('o tenant B só vê e só altera as próprias linhas; as de A ficam intactas', async () => {
    for (const t of tabelas) {
      const id = sql.identifier(t);
      const antesA = await contarTenant(t, A);
      await withTenant(
        { tenantId: B, role: 'nutri' },
        async (tx) => {
          // SELECT sem filtro: RLS precisa devolver só (e todas) as linhas de B — não zero (política que nega
          // tudo) nem inclui A (política que libera tudo).
          const vistas = await tx.execute(sql`select tenant_id from ${id}`);
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.tenant_id, t).toBe(B);
          if (SO_INSERE.has(t)) return;
          // UPDATE e DELETE sem filtro: só podem afetar as linhas que a própria RLS já mostrou (as de B).
          const alteradas = await tx.execute(sql`update ${id} set tenant_id = tenant_id`);
          expect(alteradas.rowCount, t).toBe(vistas.rows.length);
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(vistas.rows.length);
        },
        app.db,
      );
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, A), t).toBe(antesA); // owner confirma: A não foi tocado
        expect(await contarTenant(t, B), t).toBe(0); // e o DELETE de B de fato aconteceu
      }
    }
  });

  it('a paciente P2 só vê e só altera as próprias linhas; as de P1 (mesmo tenant) ficam intactas', async () => {
    for (const t of tabelas) {
      if (!(await temPaciente(t))) continue;
      const id = sql.identifier(t);
      const antesP1 = await contarPaciente(t, A, P1);
      await withTenant(
        { tenantId: A, role: 'paciente', patientId: P2 },
        async (tx) => {
          const vistas = await tx.execute(sql`select patient_id from ${id}`);
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.patient_id, t).toBe(P2);
          if (SO_INSERE.has(t)) return;
          const alteradas = await tx.execute(sql`update ${id} set patient_id = patient_id`);
          expect(alteradas.rowCount, t).toBe(vistas.rows.length);
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(vistas.rows.length);
        },
        app.db,
      );
      if (!SO_INSERE.has(t)) {
        expect(await contarPaciente(t, A, P1), t).toBe(antesP1); // owner confirma: as linhas de P1 seguem intactas
        expect(await contarPaciente(t, A, P2), t).toBe(0); // e o DELETE de P2 de fato aconteceu
      }
    }
  });
});
