import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';

export function makeDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 4 });
  return { pool, db: drizzle({ client: pool, schema }) };
}

/**
 * T5-R1: `db` cujas pré-checagens (`select().from().where()`) sempre devolvem `[]`, mantendo
 * `insert`/`update`/`delete`/`execute`/`transaction` reais — usado para forçar, de forma
 * determinística, o caminho em que só a constraint UNIQUE do Postgres barra a duplicidade
 * (sem depender de uma corrida de verdade acontecer na máquina do teste).
 */
export function semPreChecagem(db: Db): Db {
  return {
    select: () => ({ from: () => ({ where: async () => [] as never[] }) }),
    insert: db.insert.bind(db),
    update: db.update.bind(db),
    delete: db.delete.bind(db),
    execute: db.execute.bind(db),
    transaction: db.transaction.bind(db),
  } as unknown as Db;
}
