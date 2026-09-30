SELECT app_enable_tenant_rls('consultations');
--> statement-breakpoint
SELECT app_enable_patient_rls('consultations');
--> statement-breakpoint
SELECT app_enable_audit('consultations', 'atendimentos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('consultation_notes');
--> statement-breakpoint
SELECT app_enable_patient_rls('consultation_notes');
--> statement-breakpoint
SELECT app_enable_staff_only('consultation_notes');
--> statement-breakpoint
SELECT app_enable_audit('consultation_notes', 'notas_privadas');
