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
