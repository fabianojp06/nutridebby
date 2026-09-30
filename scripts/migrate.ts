import { runMigrations } from '@/db/migrate';
import { getMigratorEnv } from '@/env';

const env = getMigratorEnv();
await runMigrations({ migratorUrl: env.DATABASE_URL_MIGRATOR, appUrl: env.DATABASE_URL });
console.log('Migrations aplicadas e role da aplicação conferido.');
