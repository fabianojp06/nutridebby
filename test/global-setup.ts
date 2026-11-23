import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { novoPostgres, uriDoPostgres, urlDoBanco } from './postgres-teste';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  const c = await novoPostgres().start();
  container = c;
  // Daqui em diante, qualquer falha (migrations, fixtures, banco-modelo do SUS-100) para o contêiner antes de relançar:
  // não contamos com o teardown depois de um setup que lançou, e o Ryuk fica desligado no runner próprio
  // (docs/operacao/runner-proprio.md) — sem isto, o Postgres ficaria de pé.
  try {
    const ownerUrl = uriDoPostgres(c); // superusuário: só para migrations e fixtures
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

    // SUS-100: modelo dos bancos próprios dos testes que fazem DDL em tabela real (test/ddl.ts). Congelado aqui, antes de
    // qualquer arquivo conectar (CREATE DATABASE … TEMPLATE exige o banco de origem sem outras sessões), e fechado a
    // conexões, para nenhum teste segurar o modelo e impedir os clones.
    const modelo = 'nutri_modelo_ddl';
    const admin = new Pool({ connectionString: urlDoBanco(ownerUrl, 'postgres'), max: 1 });
    try {
      await admin.query(`CREATE DATABASE ${modelo} TEMPLATE "${c.getDatabase()}"`);
      await admin.query(`ALTER DATABASE ${modelo} WITH ALLOW_CONNECTIONS false`);
    } catch (e) {
      throw new Error(
        `SUS-100: falhou a criação do banco-modelo ${modelo} dos testes de DDL (test/ddl.ts) a partir do banco migrado ` +
          `${c.getDatabase()} (CREATE DATABASE … TEMPLATE exige a origem sem outras sessões)`,
        { cause: e },
      );
    } finally {
      await admin.end();
    }

    project.provide('ownerDatabaseUrl', ownerUrl);
    project.provide('modeloDdlDatabase', modelo);
    project.provide('appDatabaseUrl', appUrl);
    // Teste do script de backup (Tarefa 12): pg_dump e psql rodam DENTRO do container, como no host
    project.provide('pgContainerId', c.getId());
    project.provide('pgUser', c.getUsername());
    project.provide('pgDatabase', c.getDatabase());
  } catch (e) {
    container = undefined; // o teardown, se ainda rodar, não tenta parar de novo
    await c.stop().catch(() => undefined);
    throw e;
  }
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    /** SUS-100: banco-modelo (sem conexões) dos bancos próprios de `test/ddl.ts`. */
    modeloDdlDatabase: string;
    appDatabaseUrl: string;
    pgContainerId: string;
    pgUser: string;
    pgDatabase: string;
  }
}
