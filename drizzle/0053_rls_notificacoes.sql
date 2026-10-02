SELECT app_enable_tenant_rls('notifications');
--> statement-breakpoint
SELECT app_enable_patient_rls('notifications');
--> statement-breakpoint
-- D11: os lembretes da consulta marcada pela página pública (Tarefa 8) nascem no contexto publico;
-- o INSERT … ON CONFLICT exige ler a linha nova ('select'). Nada de update/delete.
SELECT app_allow_publico('notifications', 'select', 'insert');
