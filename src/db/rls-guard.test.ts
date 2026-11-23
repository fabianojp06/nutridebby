import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { bancoProprioParaDdl } from '../../test/ddl';
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
  findRecepcaoViolations,
  RECEPCAO_CONDICOES,
  RECEPCAO_LIBERADO,
} from './rls-guard';

// SUS-100: os testes de "a guarda funciona" fazem DDL (drop/create policy, drop trigger) em tabela real; num banco
// próprio, clonado do modelo pós-migrations, as travas AccessExclusive não disputam com os outros arquivos (40P01).
const owner = bancoProprioParaDdl();

describe('banco próprio dos testes de DDL (SUS-100)', () => {
  it('a guarda roda num clone do banco migrado, não no banco compartilhado', async () => {
    // Sem conexão a mais no banco compartilhado: o nome dele vem do global-setup, e as migrations do clone são contadas
    // contra o journal do drizzle-kit (a fonte), não contra outro banco que viria do mesmo modelo.
    const { rows } = await owner.pool.query<{ banco: string; migrations: number }>(
      'select current_database() as banco, (select count(*)::int from drizzle.__drizzle_migrations) as migrations',
    );
    const journal = JSON.parse(readFileSync(path.resolve('drizzle/meta/_journal.json'), 'utf8')) as { entries: unknown[] };
    expect(rows[0].banco).toMatch(/^ddl_/);
    expect(rows[0].banco).not.toBe(inject('pgDatabase'));
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(rows[0].migrations).toBe(journal.entries.length);
  });

  it('o clone tem os privilégios do nível do banco do compartilhado (CONNECT do app, sem TEMPORARY de PUBLIC)', async () => {
    // pg_database é catálogo do cluster: o clone lê a ACL dos dois bancos sem abrir conexão no compartilhado.
    const acl = `select array(select a::text from pg_database d, unnest(d.datacl) a where d.datname = $1 order by 1) as acl`;
    const [clone, base] = await Promise.all([
      owner.pool.query<{ acl: string[] }>(acl.replace('$1', 'current_database()')),
      owner.pool.query<{ acl: string[] }>(acl, [inject('pgDatabase')]),
    ]);
    expect(base.rows[0].acl.length).toBeGreaterThan(0);
    expect(clone.rows[0].acl).toEqual(base.rows[0].acl);
  });
});

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

describe('recepção (RN-505, Plano 26)', () => {
  it('toda tabela com tenant_id nega a recepção ou bate com RECEPCAO_LIBERADO e RECEPCAO_CONDICOES; as listas não citam tabela inexistente', async () => {
    expect(await findRecepcaoViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { RECEPCAO_LIBERADO, RECEPCAO_CONDICOES })).toEqual([]);
  });
  it('tabela nova nasce negada; perder a negada, liberar sem declarar, condição PERMISSIVE ou nome fora dos padrões quebram (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_recepcao (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_recepcao')`);
      await client.query('create table tmp_recepcao_sem (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_recepcao_sem')`);
      await client.query('create table tmp_recepcao_liberada (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_recepcao_liberada')`);
      await client.query(`select app_allow_recepcao('tmp_recepcao_liberada', 'select')`);
      let v = await findRecepcaoViolations(client);
      expect(v.map((x) => x.table)).not.toContain('tmp_recepcao');
      expect(v).toContainEqual({ table: 'tmp_recepcao_liberada', problem: 'liberada à recepção sem entrada em RECEPCAO_LIBERADO' });
      await client.query('drop policy recepcao_negada on tmp_recepcao_sem');
      // uma condição PERMISSIVE somaria (OR) com tenant_isolation e abriria os outros consultórios
      await client.query(`create policy recepcao_cond_x on anthropometry as permissive for select using (true)`);
      // fora dos três padrões (recepcao_negada, recepcao_sem_<cmd>, recepcao_cond_<assunto>)
      await client.query(
        `create policy recepcao_sem_bloqueados on patients as restrictive for all using (app_current_role() is distinct from 'recepcao' or status <> 'bloqueado')`,
      );
      v = await findRecepcaoViolations(client);
      expect(v).toContainEqual({ table: 'tmp_recepcao_sem', problem: 'sem política recepcao_negada (app_enable_tenant_rls/app_deny_recepcao)' });
      expect(v).toContainEqual({ table: 'anthropometry', problem: 'condição recepcao_cond_x PERMISSIVE (toda condição da recepção é RESTRICTIVE)' });
      expect(v).toContainEqual({ table: 'anthropometry', problem: 'condição recepcao_cond_x sem entrada em RECEPCAO_CONDICOES' });
      expect(v).toContainEqual({ table: 'patients', problem: 'política recepcao_sem_bloqueados fora dos padrões (recepcao_negada, recepcao_sem_<cmd>, recepcao_cond_<assunto>)' });
      await expect(client.query(`select app_allow_recepcao('tmp_recepcao', 'truncate')`)).rejects.toThrow(/comando inválido/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('B-5 da recepção: nome certo com o comando errado, ou sem a negação na expressão, também quebra; a condição declarada exige os trechos', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy recepcao_negada on exams');
      await client.query('create policy recepcao_negada on exams as restrictive for all using (true) with check (true)');
      await client.query('drop policy recepcao_sem_update on equipe_membros');
      await client.query(`create policy recepcao_sem_update on equipe_membros as restrictive for select using (app_current_role() is distinct from 'recepcao')`);
      await client.query('drop policy recepcao_cond_propria_linha on equipe_membros');
      await client.query(
        `create policy recepcao_cond_propria_linha on equipe_membros as restrictive for select using (app_current_role() is distinct from 'recepcao' or true)`,
      );
      const v = await findRecepcaoViolations(client);
      expect(v).toContainEqual({ table: 'exams', problem: 'sem política recepcao_negada (app_enable_tenant_rls/app_deny_recepcao)' });
      expect(v.filter((x) => x.table === 'equipe_membros').map((x) => x.problem).sort()).toEqual([
        'condição recepcao_cond_propria_linha sem o comando ou os trechos de RECEPCAO_CONDICOES',
        'políticas da recepção diferentes de RECEPCAO_LIBERADO (esperado recepcao_sem_delete, recepcao_sem_insert, recepcao_sem_update)',
      ]);
      await client.query('drop policy recepcao_cond_propria_linha on equipe_membros');
      expect(await findRecepcaoViolations(client)).toContainEqual({ table: 'equipe_membros', problem: 'sem a condição recepcao_cond_propria_linha (RECEPCAO_CONDICOES)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
