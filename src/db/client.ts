import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { getServerEnv } from '@/env';

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
