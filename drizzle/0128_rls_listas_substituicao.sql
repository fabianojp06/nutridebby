-- Plano 19 (spec §9.2): listas de substituição da biblioteca (RN-251).
-- Do consultório, sem paciente: a sessão de paciente nunca vê (staff_only, nem as linhas do próprio tenant); sem
-- gatilho de auditoria (não é dado de saúde).
SELECT app_enable_tenant_rls('listas_substituicao');
--> statement-breakpoint
SELECT app_enable_staff_only('listas_substituicao');
