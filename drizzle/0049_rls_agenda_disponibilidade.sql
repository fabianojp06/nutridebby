-- US-030 / D11: regras e bloqueios de atendimento são só da equipe (staff_only); o paciente só recebe horários livres já calculados.
SELECT app_enable_tenant_rls('availability_rules');
--> statement-breakpoint
SELECT app_enable_staff_only('availability_rules');
--> statement-breakpoint
SELECT app_enable_tenant_rls('availability_blocks');
--> statement-breakpoint
SELECT app_enable_staff_only('availability_blocks');
