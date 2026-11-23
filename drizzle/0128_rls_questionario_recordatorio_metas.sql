-- Plano 27 (spec §9.1 a §9.4): questionário pré-consulta, recordatório 24 h e metas. CLAUDE.md regras 2 e 8.
-- (1) questionario_envios: dado do titular (sem staff_only, sem app_allow_publico). RN-529: o paciente (com e sem login) só
-- responde, por UPDATE; o gatilho questionario_envios_regras confere as colunas e as transições de cada papel.
-- FK composta para a anamnese da cópia (RN-531): aqui, e não na gerada, porque o drizzle-kit cria o UNIQUE novo
-- anamneses_tenant_paciente_id_unique (tabela existente) depois das FKs da gerada (42830). MATCH SIMPLE: nulo não é conferido
ALTER TABLE questionario_envios ADD CONSTRAINT questionario_envios_anamnese_fk FOREIGN KEY (tenant_id, patient_id, anamnese_id)
  REFERENCES anamneses (tenant_id, patient_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
SELECT app_enable_tenant_rls('questionario_envios');
--> statement-breakpoint
SELECT app_enable_patient_rls('questionario_envios');
--> statement-breakpoint
-- QP-D36: entidade `questionario` ("Questionário pré-consulta"); a resposta também grava `questionario_resposta` pelo módulo
SELECT app_enable_audit('questionario_envios', 'questionario');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('questionario_envios', 'update');
--> statement-breakpoint
-- o envio é prontuário: cancela-se ou expira, nunca se apaga
REVOKE DELETE, TRUNCATE ON questionario_envios FROM nutri_app_role;
--> statement-breakpoint
-- (2) anamnesis_templates (QP-D25): modelos de anamnese e de questionário e a configuração do envio automático — só a
-- equipe; o paciente recebe as perguntas pela cópia em questionario_envios.modelo_snapshot
SELECT app_enable_staff_only('anamnesis_templates');
--> statement-breakpoint
-- (3) recordatorios e recordatorio_itens: dado do titular (o portal não lê na v1, QP-D16); sem escrita do paciente (nega por
-- app_enable_tenant_rls) e sem publico
SELECT app_enable_tenant_rls('recordatorios');
--> statement-breakpoint
SELECT app_enable_patient_rls('recordatorios');
--> statement-breakpoint
SELECT app_enable_audit('recordatorios', 'recordatorio');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recordatorio_itens');
--> statement-breakpoint
SELECT app_enable_patient_rls('recordatorio_itens');
--> statement-breakpoint
-- fora do Histórico (QP-D36): o Histórico mostra um "Criou"/"Alterou" da mãe por salvamento, nunca um "Excluiu" por item
SELECT app_enable_audit('recordatorio_itens', 'recordatorio_item');
--> statement-breakpoint
-- QP-D17: o recordatório não é apagado (os itens sim, na edição; e em cascata de um DELETE que o código não faz)
REVOKE DELETE, TRUNCATE ON recordatorios FROM nutri_app_role;
--> statement-breakpoint
-- (4) metas_modelos: biblioteca de metas do consultório — só a equipe; o paciente recebe a cópia em metas_paciente. Sem
-- paciente: sem auditoria
SELECT app_enable_tenant_rls('metas_modelos');
--> statement-breakpoint
SELECT app_enable_staff_only('metas_modelos');
--> statement-breakpoint
-- metas_paciente: o paciente lê as próprias metas e nunca as grava (sem app_allow_paciente_escrita — QP-D34: sem `update`,
-- SELECT … FOR SHARE/KEY SHARE da sessão de paciente não enxerga a linha)
SELECT app_enable_tenant_rls('metas_paciente');
--> statement-breakpoint
SELECT app_enable_patient_rls('metas_paciente');
--> statement-breakpoint
SELECT app_enable_audit('metas_paciente', 'metas');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON metas_paciente FROM nutri_app_role;
--> statement-breakpoint
-- metas_registros (RN-547): o paciente com login registra a própria meta de hoje ou de ontem e troca `cumprida`
SELECT app_enable_tenant_rls('metas_registros');
--> statement-breakpoint
SELECT app_enable_patient_rls('metas_registros');
--> statement-breakpoint
-- "Registrou meta" (QP-D36)
SELECT app_enable_audit('metas_registros', 'metas_registro');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('metas_registros', 'insert', 'update');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON metas_registros FROM nutri_app_role;
--> statement-breakpoint
-- O link sem login nunca registra meta, nem lê os registros (molde patient_cadastro_paciente_com_conta, 0125)
CREATE POLICY paciente_meta_registro_com_conta ON metas_registros AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL)
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL);
