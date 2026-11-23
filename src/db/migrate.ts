import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const ROLE_NAME = /^[a-z_][a-z0-9_]{2,62}$/;

/**
 * RE-D64 (Plano 26): o migrador do Drizzle aplica todas as migrations pendentes numa transação só
 * (drizzle-orm pg-core/dialect.js). O `lock_timeout` de 10 s na conexão vale para cada espera de trava, em todos os comandos
 * da execução (não é um teto da execução inteira: as esperas somam): uma migration que espera a trava de uma tabela lida em
 * toda requisição (como `user`) desiste em 10 s em vez de enfileirar o app atrás dela; a transação volta inteira, o processo
 * sai com erro (scripts/migrate.ts, docker-entrypoint.sh com `set -e`) e o Swarm reinicia o container, que tenta de novo
 * (docs/operacao/recepcao.md).
 */
export function poolDoMigrador(migratorUrl: string): Pool {
  return new Pool({ connectionString: migratorUrl, max: 1, options: '-c lock_timeout=10s' });
}

export async function runMigrations(opts: { migratorUrl: string; appUrl: string }): Promise<void> {
  const pool = poolDoMigrador(opts.migratorUrl);
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
      const me = await client.query<{ su: boolean }>('select rolsuper as su from pg_roles where rolname = current_user');
      if (me.rows[0]?.su) {
        await client.query(
          `ALTER ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pw}`,
        );
      } else {
        // Migrator sem superusuário (produção, Tarefa 13): no PG 16 ele não pode nem citar
        // SUPERUSER/BYPASSRLS/CREATEDB no ALTER ROLE; só sincroniza login e senha e confere abaixo.
        await client.query(`ALTER ROLE ${ident} LOGIN PASSWORD ${pw}`);
      }
      const attrs = await client.query<{ perigoso: boolean }>(
        `select rolsuper or rolbypassrls or rolcreatedb or rolcreaterole as perigoso from pg_roles where rolname = $1`,
        [user],
      );
      if (attrs.rows[0]?.perigoso) {
        throw new Error(`O role ${user} tem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE; remova como superusuário antes de migrar`);
      }
    }
    await client.query(`GRANT nutri_app_role TO ${ident}`);
    const { rows } = await client.query<{ d: string }>('select current_database() as d');
    await client.query(`GRANT CONNECT ON DATABASE "${rows[0].d}" TO ${ident}`);
    // M5: tabela temporária fica fora da RLS (e já foi vetor de desvio de search_path, T4-R2a).
    // Nenhum role da aplicação precisa dela; o dono do banco (o migrator em produção, sem
    // superusuário) pode revogar o privilégio padrão de PUBLIC — e segue com TEMP como dono.
    await client.query(`REVOKE TEMPORARY ON DATABASE "${rows[0].d}" FROM PUBLIC`);
    // G6: se quem roda não é o dono do banco, o REVOKE acima só gera WARNING e nada muda.
    // Confere o efeito no role da aplicação (PUBLIC, concessão direta ou herdada) e para aqui.
    const temp = await client.query<{ pode: boolean }>(
      `select has_database_privilege($1, current_database(), 'TEMPORARY') as pode`,
      [user],
    );
    if (temp.rows[0]?.pode) {
      throw new Error(
        `O role ${user} ainda pode criar tabela temporária no banco ${rows[0].d}: o REVOKE TEMPORARY não teve efeito. ` +
          `O banco precisa pertencer ao migrator (DATABASE_URL_MIGRATOR), ou o dono do banco deve rodar ` +
          `REVOKE TEMPORARY ON DATABASE "${rows[0].d}" FROM PUBLIC (e de ${user}, se tiver sido concedido direto)`,
      );
    }
    // No PG 16 um migrator sem superusuário (só CREATEROLE) recebe ADMIN sobre o role que
    // criou, mas não SET; CREATE SCHEMA ... AUTHORIZATION exige poder assumir o role dono.
    // Não amplia o poder do migrator: com ADMIN ele já controla a senha desse role.
    await client.query(`GRANT ${ident} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE`);
    // pg-boss cria as próprias tabelas neste schema (Tarefa 10)
    await client.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${ident}`);
  } finally {
    client.release();
  }
}
