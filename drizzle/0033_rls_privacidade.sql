SELECT app_enable_tenant_rls('privacy_requests');
--> statement-breakpoint
SELECT app_enable_patient_rls('privacy_requests');
--> statement-breakpoint
SELECT app_enable_audit('privacy_requests', 'pedidos_titular');
