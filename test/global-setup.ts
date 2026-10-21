import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { novoPostgres, uriDoPostgres } from './postgres-teste';

let container: StartedPostgreSqlContainer;

export async function setup(project: TestProject) {
  container = await novoPostgres().start();
  const ownerUrl = uriDoPostgres(container); // superusuário: só para migrations e fixtures
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
    SELECT app_enable_audit('rls_fixture_patient_items', 'rls_fixture');

    -- Tabela de saúde de exemplo para os testes de auditoria (Tarefa 4 do Plano 02)
    CREATE TABLE IF NOT EXISTS audit_fixture_registros (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      patient_id uuid NOT NULL,
      texto text NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON audit_fixture_registros TO nutri_app_role;
    SELECT app_enable_tenant_rls('audit_fixture_registros');
    SELECT app_enable_patient_rls('audit_fixture_registros');
    SELECT app_enable_audit('audit_fixture_registros', 'registros_teste');

    -- Só para os testes de deadlock da agenda (P15-04): a sessão "outra" do teste alonga o próprio deadlock_timeout para
    -- forçar a vítima. Não existe em produção e nunca deve virar migration.
    GRANT SET ON PARAMETER deadlock_timeout TO nutri_app_role;
  `);
  await owner.end();

  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
  // Teste do script de backup (Tarefa 12): pg_dump e psql rodam DENTRO do container, como no host
  project.provide('pgContainerId', container.getId());
  project.provide('pgUser', container.getUsername());
  project.provide('pgDatabase', container.getDatabase());
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
    pgContainerId: string;
    pgUser: string;
    pgDatabase: string;
  }
}
