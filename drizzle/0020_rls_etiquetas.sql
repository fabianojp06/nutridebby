-- US-016 / US-019: tabelas que a sessão de paciente nunca vê, nem as próprias linhas (notas
-- privadas, etiquetas). RESTRICTIVE: soma-se (AND) às políticas de tenant e de paciente.
CREATE OR REPLACE FUNCTION app_enable_staff_only(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS staff_only ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY staff_only ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L) WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
    tbl, 'paciente', 'paciente');
END $$;
--> statement-breakpoint
SELECT app_enable_tenant_rls('patient_tags');
--> statement-breakpoint
SELECT app_enable_staff_only('patient_tags');
--> statement-breakpoint
SELECT app_enable_tenant_rls('patient_tag_links');
--> statement-breakpoint
SELECT app_enable_patient_rls('patient_tag_links');
--> statement-breakpoint
SELECT app_enable_staff_only('patient_tag_links');
--> statement-breakpoint
-- "gestante", "diabetes": etiqueta é dado de saúde
SELECT app_enable_audit('patient_tag_links', 'etiquetas');
