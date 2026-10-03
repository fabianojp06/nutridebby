SELECT app_enable_tenant_rls('diary_entries');
--> statement-breakpoint
SELECT app_enable_patient_rls('diary_entries');
--> statement-breakpoint
-- RNF-08: o diário é dado de saúde (texto do que comeu, foto); escritas no "Histórico de acessos" como "Diário"
SELECT app_enable_audit('diary_entries', 'diario');
--> statement-breakpoint
-- US-042 / D11: o paciente só cria registros (não altera nem apaga)
SELECT app_allow_paciente_escrita('diary_entries', 'insert');
