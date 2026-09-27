SELECT app_enable_tenant_rls('audit_log');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM nutri_app_role;
