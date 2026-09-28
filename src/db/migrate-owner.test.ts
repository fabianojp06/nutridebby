import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from './migrate';

// Tarefa 13 (Ruling R49): em produção o migrator é um role dono do banco SEM superusuário.
// Cluster próprio, montado como no runbook, para provar que as migrations rodam assim.
let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let appUrl: string;
let owner: Pool;
let app: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  // mesmos comandos do runbook (Tarefa 13, Step 0), rodados uma vez como postgres
  await su.query(`CREATE ROLE nutri_owner LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD 'owner-pw'`);
  await su.query('CREATE DATABASE nutri OWNER nutri_owner');
  await su.end();
  const url = (user: string, password: string) => {
    const u = new URL(container.getConnectionUri());
    u.username = user;
    u.password = password;
    u.pathname = '/nutri';
    return u.toString();
  };
  ownerUrl = url('nutri_owner', 'owner-pw');
  appUrl = url('nutri_app', 'app-pw');
  await runMigrations({ migratorUrl: ownerUrl, appUrl });
  owner = new Pool({ connectionString: ownerUrl, max: 1 });
  app = new Pool({ connectionString: appUrl, max: 1 });
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await container?.stop();
});

describe('migrations com migrator sem superusuário (runbook da Tarefa 13)', () => {
  it('o migrator não é superusuário e é dono do banco', async () => {
    const { rows } = await owner.query(
      `select r.rolsuper, pg_get_userbyid(d.datdba) as dono from pg_roles r, pg_database d
        where r.rolname = current_user and d.datname = current_database()`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, dono: 'nutri_owner' });
  });

  it('instala as extensões e cria o role da aplicação sem privilégios perigosos', async () => {
    const ext = await owner.query(
      `select extname from pg_extension where extname in ('citext','pg_trgm','unaccent','btree_gist') order by 1`,
    );
    expect(ext.rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pg_trgm', 'unaccent']);
    const { rows } = await owner.query(
      `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'nutri_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it('a aplicação conecta, lê as tabelas e é dona do schema do pg-boss', async () => {
    const who = await app.query(`select current_user as u, pg_has_role(current_user, 'nutri_app_role', 'member') as m`);
    expect(who.rows[0]).toEqual({ u: 'nutri_app', m: true });
    await expect(app.query('select count(*) from "user"')).resolves.toBeTruthy();
    const schema = await owner.query(`select pg_get_userbyid(nspowner) as dono from pg_namespace where nspname = 'pgboss'`);
    expect(schema.rows[0]).toEqual({ dono: 'nutri_app' });
  });

  it('rodar de novo com o mesmo migrator é seguro (sincroniza a senha sem exigir superusuário)', async () => {
    await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).resolves.toBeUndefined();
  });

  it('recusa seguir se o role da aplicação ganhou atributo perigoso (o migrator não pode removê-lo)', async () => {
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    try {
      await su.query('ALTER ROLE nutri_app CREATEDB');
      await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).rejects.toThrow(/CREATEDB/);
    } finally {
      await su.query('ALTER ROLE nutri_app NOCREATEDB');
      await su.end();
    }
  });
});
