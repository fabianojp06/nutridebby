SELECT app_enable_tenant_rls('anamnesis_templates');
--> statement-breakpoint
SELECT app_enable_tenant_rls('anamneses');
--> statement-breakpoint
SELECT app_enable_patient_rls('anamneses');
--> statement-breakpoint
SELECT app_enable_audit('anamneses', 'anamnese');
