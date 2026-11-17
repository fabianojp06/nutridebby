-- Plano 19 (spec §9.2): perfis de referência de nutrientes (RN-238).
-- Do consultório, sem paciente: a sessão de paciente nunca vê (staff_only, nem as linhas do próprio tenant); sem
-- gatilho de auditoria (não é dado de saúde).
SELECT app_enable_tenant_rls('referencias_nutrientes');
--> statement-breakpoint
SELECT app_enable_staff_only('referencias_nutrientes');
