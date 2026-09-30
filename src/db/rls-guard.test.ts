import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { findRlsViolations, findStaffOnlyViolations, findStaleExceptions, listTenantTables, PATIENT_POLICY_EXCEPTIONS, RLS_EXCEPTIONS, STAFF_ONLY } from './rls-guard';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('guarda de RLS (US-006: "Nova tabela sem RLS quebra o CI")', () => {
  it('nenhuma tabela com tenant_id está fora da regra', async () => {
    const tables = await listTenantTables(owner.pool);
    expect(tables).toContain('audit_log');
    expect(tables).toContain('rls_fixture_patient_items');
    const violations = await findRlsViolations(owner.pool);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('patients (titular na coluna id) também exige patient_isolation', async () => {
    const { rows } = await owner.pool.query(`select 1 from pg_policies where schemaname = 'public' and tablename = 'patients' and policyname = 'patient_isolation'`);
    expect(rows).toHaveLength(1);
  });

  it('detecta uma tabela nova com tenant_id sem RLS (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_sem_rls (id int primary key, tenant_id uuid not null)');
      await client.query('create table tmp_sem_paciente (id int primary key, tenant_id uuid not null, patient_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_sem_paciente')`);
      await client.query('create table tmp_particionada (id int, tenant_id uuid not null) partition by list (tenant_id)');
      const v = await findRlsViolations(client);
      expect(v).toContainEqual({ table: 'tmp_sem_rls', problem: 'RLS não habilitada' });
      expect(v).toContainEqual({ table: 'tmp_sem_paciente', problem: 'sem política patient_isolation' });
      expect(v).toContainEqual({ table: 'tmp_particionada', problem: 'RLS não habilitada' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('staff_only (US-016, US-019)', () => {
  it('toda tabela da lista STAFF_ONLY tem a política, e a lista não cita tabela inexistente', async () => {
    expect(await findStaffOnlyViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { RLS_EXCEPTIONS, PATIENT_POLICY_EXCEPTIONS, STAFF_ONLY })).toEqual([]);
  });
  it('detecta a tabela da lista sem a política (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy staff_only on patient_tags');
      expect(await findStaffOnlyViolations(client)).toContainEqual({ table: 'patient_tags', problem: 'sem política staff_only (app_enable_staff_only)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
