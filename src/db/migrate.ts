import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const ROLE_NAME = /^[a-z_][a-z0-9_]{2,62}$/;

export async function runMigrations(opts: { migratorUrl: string; appUrl: string }): Promise<void> {
  const pool = new Pool({ connectionString: opts.migratorUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });
    await ensureAppLogin(pool, opts.appUrl);
  } finally {
    await pool.end();
  }
}

/** Cria (ou atualiza) o role de login da aplicação a partir das credenciais de DATABASE_URL. */
export async function ensureAppLogin(pool: Pool, appUrl: string): Promise<void> {
  const url = new URL(appUrl);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  if (!ROLE_NAME.test(user)) throw new Error(`Nome de role inválido em DATABASE_URL: ${user}`);
  if (!pass) throw new Error('DATABASE_URL precisa de senha para o role da aplicação');

  const client = await pool.connect();
  try {
    const ident = `"${user}"`;
    const pw = client.escapeLiteral(pass);
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [user]);
    if (exists.rowCount === 0) {
      await client.query(
        `CREATE ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pw}`,
      );
    } else {
      await client.query(`ALTER ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pw}`);
    }
    await client.query(`GRANT nutri_app_role TO ${ident}`);
    const { rows } = await client.query<{ d: string }>('select current_database() as d');
    await client.query(`GRANT CONNECT ON DATABASE "${rows[0].d}" TO ${ident}`);
    // pg-boss cria as próprias tabelas neste schema (Tarefa 10)
    await client.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${ident}`);
  } finally {
    client.release();
  }
}
