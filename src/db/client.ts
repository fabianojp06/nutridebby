import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';
import { sanitizarErroDeBanco } from './errors';
import * as schema from './schema';
import { getServerEnv } from '@/env';

/**
 * RNF-11 / CLAUDE.md regra 3: o `DrizzleQueryError` leva o SQL e os parâmetros (e-mail, nome, hash de
 * senha) na `message`. Toda consulta do Drizzle — withTenant, consultas diretas, Better Auth, transações —
 * passa por `PgPreparedQuery.queryWithCache`: é ali que o erro vira `DbError`, uma vez para o processo.
 * O teste `src/db/db-error.test.ts` quebra se uma versão nova do Drizzle mudar esse ponto.
 */
type ComConsulta = { queryWithCache?: (...args: unknown[]) => Promise<unknown>; semDadosNoErro?: true };
const prototipo = PgPreparedQuery.prototype as unknown as ComConsulta;
const original = prototipo.queryWithCache;
if (!original) throw new Error('drizzle-orm sem PgPreparedQuery.queryWithCache: revisar a sanitização de erros');
if (!prototipo.semDadosNoErro) {
  prototipo.queryWithCache = async function (this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (err) {
      throw sanitizarErroDeBanco(err) ?? err;
    }
  };
  prototipo.semDadosNoErro = true;
}

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Algo que executa consultas: o `Db` ou uma transação (`Tx`). */
export type Queryable = Pick<Tx, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(): Pool {
  return (pool ??= new Pool({ connectionString: getServerEnv().DATABASE_URL, max: 10 }));
}

export function getDb(): Db {
  return (db ??= drizzle({ client: getPool(), schema }));
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
