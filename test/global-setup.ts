import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

let container: StartedPostgreSqlContainer;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ownerUrl = container.getConnectionUri(); // superusuário: só para migrations e fixtures
  const app = new URL(ownerUrl);
  app.username = 'nutri_app';
  app.password = 'test-app-pw';
  const appUrl = app.toString();

  await runMigrations({ migratorUrl: ownerUrl, appUrl });

  // Tabela-fixture com tenant_id + patient_id para testar as duas políticas (Tarefas 4 e 5)
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  await owner.query(`
    CREATE TABLE IF NOT EXISTS rls_fixture_patient_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      patient_id uuid NOT NULL,
      texto text NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON rls_fixture_patient_items TO nutri_app_role;
    SELECT app_enable_tenant_rls('rls_fixture_patient_items');
    SELECT app_enable_patient_rls('rls_fixture_patient_items');
  `);
  await owner.end();

  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}
