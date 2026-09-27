import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';

export function makeDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 4 });
  return { pool, db: drizzle({ client: pool, schema }) };
}
