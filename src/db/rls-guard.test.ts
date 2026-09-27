import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { findRlsViolations } from './rls-guard';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('guarda de RLS (US-006: "Nova tabela sem RLS quebra o CI")', () => {
  it('nenhuma tabela com tenant_id está fora da regra', async () => {
    const violations = await findRlsViolations(owner.pool);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('detecta uma tabela nova com tenant_id sem RLS (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_sem_rls (id int primary key, tenant_id uuid not null)');
      await client.query('create table tmp_sem_paciente (id int primary key, tenant_id uuid not null, patient_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_sem_paciente')`);
      const v = await findRlsViolations(client);
      expect(v).toContainEqual({ table: 'tmp_sem_rls', problem: 'RLS não habilitada' });
      expect(v).toContainEqual({ table: 'tmp_sem_paciente', problem: 'sem política patient_isolation' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
