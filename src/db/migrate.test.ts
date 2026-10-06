import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';

const owner = makeDb(inject('ownerDatabaseUrl'));
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('migrations de base', () => {
  it('o role da aplicação não é superusuário nem ignora RLS', async () => {
    const { rows } = await owner.pool.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = 'nutri_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('a conexão da aplicação usa o role nutri_app, membro de nutri_app_role', async () => {
    const { rows } = await app.pool.query(
      `select current_user as u, pg_has_role(current_user, 'nutri_app_role', 'member') as m`,
    );
    expect(rows[0]).toEqual({ u: 'nutri_app', m: true });
  });

  it('instala as extensões exigidas pela spec', async () => {
    const { rows } = await owner.pool.query(
      `select extname from pg_extension where extname in ('citext','pg_trgm','unaccent','btree_gist') order by 1`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pg_trgm', 'unaccent']);
  });

  it('nenhuma coluna de data/hora do schema public é timestamp sem fuso', async () => {
    const { rows } = await owner.pool.query(
      `select table_name || '.' || column_name as col from information_schema.columns
        where table_schema = 'public' and data_type = 'timestamp without time zone' order by 1`,
    );
    expect(rows.map((r) => r.col)).toEqual([]);
  });

  it('fechamento do Plano 05 (0067): página pública desligada por padrão e em todos os tenants existentes (UPDATE sem WHERE); cancelado_por aceita "sistema"', async () => {
    const { rows } = await owner.pool.query(
      `select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'agendamento_publico_ativo'`,
    );
    expect(rows[0].column_default).toBe('false');
    const migration = readFileSync(new URL('../../drizzle/0067_exclusao_e_pagina_publica_desligada.sql', import.meta.url), 'utf8');
    const update = /^UPDATE "tenants" SET "agendamento_publico_ativo" = false;$/m.exec(migration)?.[0];
    expect(update).toBeDefined();
    // o mesmo SET num tenant ligado (só nele: o banco dos testes é compartilhado entre arquivos que rodam em paralelo)
    const c = await owner.pool.connect();
    try {
      await c.query('begin');
      const { rows: [t] } = await c.query(`insert into tenants (slug, nome_exibicao, agendamento_publico_ativo) values ($1, 'Mig', true) returning id`, [`mig-${randomUUID().slice(0, 8)}`]);
      await c.query(update!.replace(/;$/, ' WHERE id = $1'), [t.id]);
      expect((await c.query('select agendamento_publico_ativo as a from tenants where id = $1', [t.id])).rows[0].a).toBe(false);
    } finally {
      await c.query('rollback');
      c.release();
    }
    const { rows: check } = await owner.pool.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'appointments_cancelado_por_valido'`);
    expect(check[0].d).toContain(`'sistema'`);
  });

  it('P09-02 (a): o role da aplicação lê a versão do schema só pela função (= `when` da última migration do journal), nunca a tabela do drizzle', async () => {
    const journal = JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { when: number }[] };
    const { rows } = await app.pool.query('select app_versao_do_schema() as v');
    expect(Number(rows[0].v)).toBe(journal.entries.at(-1)!.when);
    const { versaoAplicada } = await import('@/worker/versao-schema');
    expect(await versaoAplicada(app.db)).toBe(journal.entries.at(-1)!.when);
    await expect(app.pool.query('select count(*) from drizzle.__drizzle_migrations')).rejects.toMatchObject({ code: '42501' });
  });

  it('rodar as migrations de novo é seguro (idempotente)', async () => {
    const { runMigrations } = await import('./migrate');
    await expect(
      runMigrations({ migratorUrl: inject('ownerDatabaseUrl'), appUrl: inject('appDatabaseUrl') }),
    ).resolves.toBeUndefined();
  });

  it('reaplicar as migrations remove CREATEDB/CREATEROLE caso o role já os tenha', async () => {
    await owner.pool.query('ALTER ROLE nutri_app CREATEDB CREATEROLE');

    const { runMigrations } = await import('./migrate');
    await runMigrations({
      migratorUrl: inject('ownerDatabaseUrl'),
      appUrl: inject('appDatabaseUrl'),
    });

    const { rows } = await owner.pool.query(
      `select rolcreatedb, rolcreaterole, rolsuper, rolbypassrls from pg_roles where rolname = 'nutri_app'`,
    );
    expect(rows[0]).toEqual({
      rolcreatedb: false,
      rolcreaterole: false,
      rolsuper: false,
      rolbypassrls: false,
    });
  });
});
