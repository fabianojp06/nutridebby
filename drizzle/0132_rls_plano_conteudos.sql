-- Plano 19 (spec §9.2): receitas e materiais ligados ao plano (RN-253). Com patient_id: RLS de tenant e de paciente, escritas
-- auditadas como o resto do plano (entidade plano_alimentar). Sem escrita do paciente (fora de PACIENTE_ESCREVE).
SELECT app_enable_tenant_rls('plano_conteudos');
--> statement-breakpoint
SELECT app_enable_patient_rls('plano_conteudos');
--> statement-breakpoint
SELECT app_enable_audit('plano_conteudos', 'plano_alimentar');
--> statement-breakpoint
-- D12 do Plano 04 (molde da 0045): a sessão de paciente nunca vê nem grava o que está ligado a um rascunho
CREATE POLICY paciente_sem_rascunho ON plano_conteudos AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = plano_conteudos.tenant_id AND p.id = plano_conteudos.plan_id AND p.status <> 'rascunho'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM meal_plans p WHERE p.tenant_id = plano_conteudos.tenant_id AND p.id = plano_conteudos.plan_id AND p.status <> 'rascunho'));
