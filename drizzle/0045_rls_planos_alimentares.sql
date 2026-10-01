SELECT app_enable_tenant_rls('meal_plans');
--> statement-breakpoint
SELECT app_enable_patient_rls('meal_plans');
--> statement-breakpoint
SELECT app_enable_audit('meal_plans', 'plano_alimentar');
--> statement-breakpoint
SELECT app_enable_tenant_rls('meals');
--> statement-breakpoint
SELECT app_enable_patient_rls('meals');
--> statement-breakpoint
SELECT app_enable_audit('meals', 'plano_alimentar');
--> statement-breakpoint
SELECT app_enable_tenant_rls('meal_items');
--> statement-breakpoint
SELECT app_enable_patient_rls('meal_items');
--> statement-breakpoint
SELECT app_enable_audit('meal_items', 'plano_alimentar');
--> statement-breakpoint
-- D12 (US-025 "Rascunho invisível", nem pela API): sessão de paciente nunca vê nem grava rascunho
CREATE POLICY paciente_sem_rascunho ON meal_plans AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status <> 'rascunho')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR status <> 'rascunho');
--> statement-breakpoint
CREATE POLICY paciente_sem_rascunho ON meals AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meals.tenant_id AND p.id = meals.plan_id AND p.status <> 'rascunho'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meals.tenant_id AND p.id = meals.plan_id AND p.status <> 'rascunho'));
--> statement-breakpoint
CREATE POLICY paciente_sem_rascunho ON meal_items AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meal_items.tenant_id AND p.id = meal_items.plan_id AND p.status <> 'rascunho'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = meal_items.tenant_id AND p.id = meal_items.plan_id AND p.status <> 'rascunho'));
