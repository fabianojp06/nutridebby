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
  // mesmos comandos do runbook (Tarefa 13, Step 1b), rodados uma vez como postgres
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

  it('o role da aplicação não cria tabela temporária: TEMPORARY revogado de PUBLIC (M5)', async () => {
    const priv = await owner.query(`select has_database_privilege('nutri_app', current_database(), 'TEMPORARY') as temp`);
    expect(priv.rows[0]).toEqual({ temp: false });
    await expect(app.query('create temp table desvio (i int)')).rejects.toThrow(/permission denied/);
  });

  it('REVOKE TEMPORARY sem efeito (migrator deixou de ser dono do banco) falha com mensagem clara, sem segredo (G6)', async () => {
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    try {
      // Cenário do achado: outro role é dono do banco (o migrator só tem CREATE, que as migrations
      // exigem) e PUBLIC tem TEMP; o REVOKE do migrator só gera WARNING
      await su.query('ALTER DATABASE nutri OWNER TO CURRENT_USER');
      await su.query('GRANT CREATE ON DATABASE nutri TO nutri_owner');
      await su.query('GRANT TEMPORARY ON DATABASE nutri TO PUBLIC');
      const erro = await runMigrations({ migratorUrl: ownerUrl, appUrl }).then(
        () => null,
        (e: Error) => e,
      );
      expect(erro?.message).toMatch(/nutri_app ainda pode criar tabela temporária no banco nutri/);
      expect(erro?.message).toMatch(/pertencer ao migrator/);
      expect(erro?.message).not.toMatch(/app-pw|owner-pw/);
    } finally {
      await su.query('REVOKE TEMPORARY ON DATABASE nutri FROM PUBLIC');
      await su.query('REVOKE CREATE ON DATABASE nutri FROM nutri_owner');
      await su.query('ALTER DATABASE nutri OWNER TO nutri_owner');
      await su.end();
    }
    // de volta ao runbook: roda de novo sem erro e o role da aplicação segue sem TEMP
    await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).resolves.toBeUndefined();
    const priv = await owner.query(`select has_database_privilege('nutri_app', current_database(), 'TEMPORARY') as temp`);
    expect(priv.rows[0]).toEqual({ temp: false });
  });

  it('TEMPORARY concedido direto ao role da aplicação também faz a migração parar (G6)', async () => {
    const su = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    try {
      await su.query('GRANT TEMPORARY ON DATABASE nutri TO nutri_app');
      await expect(runMigrations({ migratorUrl: ownerUrl, appUrl })).rejects.toThrow(/nutri_app ainda pode criar tabela temporária/);
    } finally {
      await su.query('REVOKE TEMPORARY ON DATABASE nutri FROM nutri_app');
      await su.end();
    }
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

  it('métricas do admin: a função SECURITY DEFINER conta por tenant sob FORCE RLS (dono sem superusuário)', async () => {
    const c = await app.connect();
    try {
      const a = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-a', 'A') returning id`)).rows[0].id as string;
      const b = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-b', 'B') returning id`)).rows[0].id as string;
      for (const [t, n] of [[a, 2], [b, 1]] as const) {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [t]);
        for (let i = 0; i < n; i++) {
          await c.query(`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values ($1, 'logo', $2, 10, 'image/png')`, [t, `${t}/logo/${crypto.randomUUID()}.png`]);
        }
        if (t === a) {
          await c.query(`insert into patients (tenant_id, nome, data_nascimento, sexo, email, status) values ($1, 'Ativo', '1990-01-01', 'F', 'ativo@met.dev', 'ativo'), ($1, 'Arquivado', '1990-01-01', 'M', 'arq@met.dev', 'arquivado')`, [t]);
        }
        await c.query('commit');
      }
      const { rows } = await c.query(`select tenant_id, arquivos::int as arquivos, pacientes_ativos from admin_tenant_metrics() where tenant_id = any($1)`, [[a, b]]);
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, r.arquivos]))).toEqual({ [a]: 2, [b]: 1 });
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.pacientes_ativos)]))).toEqual({ [a]: 1, [b]: 0 });
      // fora da função, sem contexto, o role da aplicação não vê nada
      expect((await c.query('select count(*)::int as n from stored_files')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('aceites na anonimização (0065): a função SECURITY DEFINER do migrator sem superusuário limpa o IP sob FORCE RLS; recusa paciente não bloqueado', async () => {
    const c = await app.connect();
    const emWorker = async (t: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [t]);
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('anon-aceites', 'A') returning id`)).rows[0].id as string;
      await emWorker(t);
      const [bloqueada, ativa] = (
        await c.query(
          `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status, bloqueado_em, anonimizar_apos)
           values ($1, 'Bloqueada', '1990-01-01', 'F', 'bloq@anon.dev', 'bloqueado', now(), '2026-01-01'),
                  ($1, 'Ativa', '1990-01-01', 'F', 'ativa@anon.dev', 'ativo', null, null) returning id`,
          [t],
        )
      ).rows.map((r) => r.id as string);
      await c.query('commit');
      await c.query(
        `insert into consents (tenant_id, patient_id, termo_versao, aceito_em, ip) values ($1, $2, 'termo-v1', '2026-01-01T12:00:00Z', '198.51.100.7'), ($1, $3, 'termo-v1', '2026-01-02T12:00:00Z', '198.51.100.8')`,
        [t, bloqueada, ativa],
      );
      await emWorker(t);
      await c.query('select app_anonimizar_aceites($1)', [bloqueada]);
      await c.query('commit');
      const { rows } = await c.query(`select patient_id, termo_versao, aceito_em, ip from consents where tenant_id = $1 order by aceito_em`, [t]);
      expect(rows.map((r) => [r.patient_id, r.termo_versao, (r.aceito_em as Date).toISOString(), r.ip])).toEqual([
        [bloqueada, 'termo-v1', '2026-01-01T12:00:00.000Z', null],
        [ativa, 'termo-v1', '2026-01-02T12:00:00.000Z', '198.51.100.8'],
      ]);
      await emWorker(t);
      await expect(c.query('select app_anonimizar_aceites($1)', [ativa])).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});
