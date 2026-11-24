-- Plano 22 (editado à mão). Spec §9.7, RN-393, RN-394. CLAUDE.md regra 2.
-- RN-393, RN-394 (EP-D29, EP-D30): itens salvos e modelos de prescrição — bibliotecas do consultório, só a equipe; sem
-- paciente (sem patient_id: sem app_enable_patient_rls nem auditoria); nada em PUBLICO_LIBERADO nem em PACIENTE_ESCREVE.
SELECT app_enable_tenant_rls('prescricao_itens_salvos');
--> statement-breakpoint
SELECT app_enable_staff_only('prescricao_itens_salvos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('prescricao_modelos');
--> statement-breakpoint
SELECT app_enable_staff_only('prescricao_modelos');
