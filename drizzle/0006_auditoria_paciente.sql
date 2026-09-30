ALTER TABLE "audit_log" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_paciente_idx" ON "audit_log" USING btree ("tenant_id","patient_id","criado_em");