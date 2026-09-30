SELECT app_enable_tenant_rls('data_exports');
--> statement-breakpoint
SELECT app_enable_patient_rls('data_exports');
--> statement-breakpoint
SELECT app_enable_audit('data_exports', 'exportacoes');
