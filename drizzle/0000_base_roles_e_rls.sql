CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutri_app_role') THEN
    CREATE ROLE nutri_app_role NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nutri_app_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nutri_app_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nutri_app_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_patient() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.patient_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_patient_rls(tbl regclass, col text DEFAULT 'patient_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS patient_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY patient_isolation ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L OR %I = app_current_patient()) '
    'WITH CHECK (app_current_role() IS DISTINCT FROM %L OR %I = app_current_patient())',
    tbl, 'paciente', col, 'paciente', col);
END $$;
