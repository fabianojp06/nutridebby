import { runMigrations } from '@/db/migrate';
import { getEnv } from '@/env';

const env = getEnv();
await runMigrations({ migratorUrl: env.DATABASE_URL_MIGRATOR, appUrl: env.DATABASE_URL });
console.log('Migrations aplicadas e role da aplicação conferido.');
