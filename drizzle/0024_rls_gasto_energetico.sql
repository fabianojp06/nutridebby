SELECT app_enable_tenant_rls('energy_calcs');
--> statement-breakpoint
SELECT app_enable_patient_rls('energy_calcs');
--> statement-breakpoint
SELECT app_enable_audit('energy_calcs', 'gasto_energetico');
