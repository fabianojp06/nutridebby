import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { AUDIT_EXCEPTIONS, findAuditViolations } from './audit-guard';
import { findStaleExceptions, PATIENT_POLICY_EXCEPTIONS, RLS_EXCEPTIONS } from './rls-guard';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('guarda de auditoria (US-007: toda tabela de saúde é auditada)', () => {
  it('toda tabela com patient_id tem o gatilho audit_row_change', async () => {
    const v = await findAuditViolations(owner.pool);
    expect(v, JSON.stringify(v, null, 2)).toEqual([]);
  });

  it('detecta tabela de saúde nova sem gatilho (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_saude_sem_audit (id uuid primary key, tenant_id uuid not null, patient_id uuid not null)');
      // `patients` já existe (0016): remove o gatilho só nesta transação (rollback ao fim)
      await client.query('drop trigger audit_row_change on patients');
      const v = await findAuditViolations(client);
      expect(v).toContainEqual({ table: 'tmp_saude_sem_audit', problem: 'sem gatilho de auditoria (app_enable_audit)' });
      expect(v).toContainEqual({ table: 'patients', problem: 'sem gatilho de auditoria (app_enable_audit)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('as listas de exceção só citam tabelas que existem (item adiado do Plano 01)', async () => {
    expect(await findStaleExceptions(owner.pool, { RLS_EXCEPTIONS, PATIENT_POLICY_EXCEPTIONS, AUDIT_EXCEPTIONS })).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { TESTE: { nao_existe: 'x' } })).toEqual(['TESTE: nao_existe']);
  });

  it('app_enable_audit recusa coluna do titular que não existe na tabela (T4-R2b)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_coluna_errada (id uuid primary key, tenant_id uuid not null, patient_id uuid not null)');
      await expect(client.query(`select app_enable_audit('tmp_coluna_errada', 'errado', 'paciente_id')`)).rejects.toThrow(
        /coluna.*não existe/,
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
