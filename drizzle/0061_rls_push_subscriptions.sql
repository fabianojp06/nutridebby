SELECT app_enable_tenant_rls('push_subscriptions');
--> statement-breakpoint
-- D14: o paciente (P06-02) grava, lê e apaga só as próprias inscrições; o contexto publico fica negado (publico_negado)
SELECT app_enable_patient_rls('push_subscriptions');
