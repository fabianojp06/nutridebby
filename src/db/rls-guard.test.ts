import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import {
  CONTEUDO_POR_AUDIENCIA,
  ESCRITA_POR_AUDIENCIA,
  findConteudoAudienciaViolations,
  findPacienteEscritaViolations,
  findPublicoViolations,
  findRlsViolations,
  findStaffOnlyViolations,
  findStaleExceptions,
  listTenantTables,
  PACIENTE_ESCREVE,
  PATIENT_POLICY_EXCEPTIONS,
  PUBLICO_LIBERADO,
  RLS_EXCEPTIONS,
  STAFF_ONLY,
} from './rls-guard';

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
    expect(await findStaleExceptions(owner.pool, { RLS_EXCEPTIONS, PATIENT_POLICY_EXCEPTIONS, STAFF_ONLY, PUBLICO_LIBERADO })).toEqual([]);
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

describe('contexto publico (D11)', () => {
  it('toda tabela com tenant_id nega o publico ou bate com PUBLICO_LIBERADO; a lista não cita tabela inexistente', async () => {
    expect(await findPublicoViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { PUBLICO_LIBERADO })).toEqual([]);
  });
  it('tabela nova nasce fechada; liberar sem declarar, ou perder a política, quebra (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_publico (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_publico')`);
      await client.query('create table tmp_liberada (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_liberada')`);
      await client.query(`select app_allow_publico('tmp_liberada', 'select')`);
      let v = await findPublicoViolations(client);
      expect(v.map((x) => x.table)).not.toContain('tmp_publico');
      expect(v).toContainEqual({ table: 'tmp_liberada', problem: 'liberada ao publico sem entrada em PUBLICO_LIBERADO' });
      await client.query('drop policy publico_negado on tmp_publico');
      await client.query('drop policy publico_sem_update on appointments'); // a lista exige; sumiu → acusa
      v = await findPublicoViolations(client);
      expect(v).toContainEqual({ table: 'tmp_publico', problem: 'sem política publico_negado (app_enable_tenant_rls/app_deny_publico)' });
      expect(v.map((x) => x.table)).toContain('appointments');
      await expect(client.query(`select app_allow_publico('tmp_publico', 'truncate')`)).rejects.toThrow(/comando inválido/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('a política com o nome certo mas o comando errado também quebra (publico_sem_delete criada FOR SELECT)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy publico_sem_delete on appointments');
      await client.query(`create policy publico_sem_delete on appointments as restrictive for select using (app_current_role() is distinct from 'publico')`);
      expect((await findPublicoViolations(client)).map((x) => x.table)).toContain('appointments');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('escrita da sessão de paciente (D1, P-16 a)', () => {
  it('toda tabela com tenant_id nega a escrita do paciente ou bate com PACIENTE_ESCREVE; a lista não cita tabela inexistente', async () => {
    expect(await findPacienteEscritaViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { PACIENTE_ESCREVE })).toEqual([]);
  });
  it('tabela nova nasce fechada; liberar sem declarar, ou perder a política, quebra (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_paciente (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_paciente')`);
      await client.query('create table tmp_paciente_liberada (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_paciente_liberada')`);
      await client.query(`select app_allow_paciente_escrita('tmp_paciente_liberada', 'insert')`);
      let v = await findPacienteEscritaViolations(client);
      expect(v.map((x) => x.table)).not.toContain('tmp_paciente');
      expect(v).toContainEqual({ table: 'tmp_paciente_liberada', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
      await client.query('drop policy paciente_sem_delete on tmp_paciente');
      await client.query('drop policy paciente_sem_insert on anthropometry');
      v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'tmp_paciente', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
      expect(v).toContainEqual({ table: 'anthropometry', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
      expect(v.map((x) => x.table)).not.toContain('patients'); // update liberado em PACIENTE_ESCREVE e sem a política: certo
      await expect(client.query(`select app_allow_paciente_escrita('tmp_paciente', 'select')`)).rejects.toThrow(/comando inválido/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('PACIENTE_ESCREVE libera um comando que o banco nega → quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select app_deny_paciente_escrita('appointments')`); // volta a negar insert/update
      const v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'appointments', problem: 'PACIENTE_ESCREVE libera insert, mas o banco nega (paciente_sem_insert)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('a política com o nome certo mas o comando errado também quebra (paciente_sem_delete criada FOR SELECT)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_sem_delete on exams');
      await client.query(`create policy paciente_sem_delete on exams as restrictive for select using (app_current_role() is distinct from 'paciente')`);
      expect(await findPacienteEscritaViolations(client)).toContainEqual({ table: 'exams', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('B-5: a política com o nome e o comando certos, mas que não nega nada (USING true), também quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_sem_delete on exams');
      await client.query('create policy paciente_sem_delete on exams as restrictive for delete using (true)');
      await client.query('drop policy paciente_sem_insert on contents');
      await client.query('create policy paciente_sem_insert on contents as restrictive for insert with check (true)');
      const v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'exams', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
      expect(v).toContainEqual({ table: 'contents', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('leitura por audiência (RN-12, Plano 07)', () => {
  it('toda tabela de CONTEUDO_POR_AUDIENCIA tem a política RESTRICTIVE de SELECT; a lista não cita tabela inexistente', async () => {
    expect(await findConteudoAudienciaViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { CONTEUDO_POR_AUDIENCIA, ESCRITA_POR_AUDIENCIA })).toEqual([]);
  });
  it('perder a política quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_conteudo_visivel on recipe_ingredients');
      expect(await findConteudoAudienciaViolations(client)).toEqual([{ table: 'recipe_ingredients', problem: 'sem política paciente_conteudo_visivel (RN-12)' }]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('R11: a política com o nome, o comando e RESTRICTIVE certos, mas sem a audiência (USING true, ou sem o ramo da etiqueta), também quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_conteudo_visivel on recipes');
      await client.query('create policy paciente_conteudo_visivel on recipes as restrictive for select using (true)');
      await client.query('drop policy paciente_conteudo_visivel on contents');
      await client.query(
        `create policy paciente_conteudo_visivel on contents as restrictive for select
           using (app_current_role() is distinct from 'paciente' or (status = 'publicado' and visibilidade in ('todos', 'etiquetas')))`,
      );
      // a filha que herda sem ligar a linha (EXISTS de qualquer conteúdo visível) mostraria todas as receitas do tenant
      await client.query('drop policy paciente_conteudo_visivel on recipe_ingredients');
      await client.query(
        `create policy paciente_conteudo_visivel on recipe_ingredients as restrictive for select
           using (app_current_role() is distinct from 'paciente' or exists (select 1 from contents c))`,
      );
      expect(await findConteudoAudienciaViolations(client)).toEqual([
        { table: 'contents', problem: 'paciente_conteudo_visivel sem a audiência (RN-12)' },
        { table: 'recipes', problem: 'paciente_conteudo_visivel sem a audiência (RN-12)' },
        { table: 'recipe_ingredients', problem: 'paciente_conteudo_visivel sem a audiência (RN-12)' },
      ]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('US-055/D14: a escrita do paciente (visualização, favorito) exige as políticas RESTRICTIVE de INSERT com a audiência e sem a liberação do plano', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_conteudo_visto on content_views');
      await client.query('drop policy paciente_conteudo_favorito on content_favorites');
      // sem a trava da liberação do plano (D14): quem abre só pelo cartão passaria a favoritar
      await client.query(
        `create policy paciente_conteudo_favorito on content_favorites as restrictive for insert
           with check (app_current_role() is distinct from 'paciente' or exists (
             select 1 from contents c where c.tenant_id = content_favorites.tenant_id and c.id = content_favorites.content_id))`,
      );
      expect(await findConteudoAudienciaViolations(client)).toEqual([
        { table: 'content_views', problem: 'sem política paciente_conteudo_visto (US-055, D14)' },
        { table: 'content_favorites', problem: 'paciente_conteudo_favorito sem a audiência (US-055, D14)' },
      ]);
      // nome certo, mas PERMISSIVE (não restringe nada) ou FOR SELECT: também quebra
      await client.query('drop policy paciente_conteudo_favorito on content_favorites');
      await client.query(`create policy paciente_conteudo_visto on content_views as restrictive for select using (true)`);
      await client.query(
        `create policy paciente_conteudo_favorito on content_favorites as permissive for insert
           with check (app_current_role() is distinct from 'paciente' or (current_setting('app.receitas_do_plano', true) is distinct from 'on' and exists (
             select 1 from contents c where c.tenant_id = content_favorites.tenant_id and c.id = content_favorites.content_id)))`,
      );
      expect(await findConteudoAudienciaViolations(client)).toEqual([
        { table: 'content_views', problem: 'sem política paciente_conteudo_visto (US-055, D14)' },
        { table: 'content_favorites', problem: 'sem política paciente_conteudo_favorito (US-055, D14)' },
      ]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('teste de restauração (regra 10): a lista do script acompanha RLS_EXCEPTIONS', () => {
  it('nutri-restauracao-teste.sh deixa fora da conta exatamente as tabelas de RLS_EXCEPTIONS', () => {
    const script = readFileSync(path.resolve('scripts/backup/nutri-restauracao-teste.sh'), 'utf8');
    const m = script.match(/c\.relname not in \(([^)]*)\)/);
    expect(m, 'a lista "c.relname not in (…)" do sem_rls sumiu do script').not.toBeNull();
    const doScript = m![1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''));
    // mudou a lista → o dono reinstala o script no host (regra 10 do CLAUDE.md, P02-11)
    expect(doScript.sort()).toEqual(Object.keys(RLS_EXCEPTIONS).sort());
  });
});
