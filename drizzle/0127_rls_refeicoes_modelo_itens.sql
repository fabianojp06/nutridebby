-- Plano 19 (spec §9.2): itens de "Minhas refeições" (RN-250).
-- Do consultório, sem paciente: a sessão de paciente nunca vê (staff_only, nem as linhas do próprio tenant); sem
-- gatilho de auditoria (não é dado de saúde).
SELECT app_enable_tenant_rls('refeicoes_modelo_itens');
--> statement-breakpoint
SELECT app_enable_staff_only('refeicoes_modelo_itens');
