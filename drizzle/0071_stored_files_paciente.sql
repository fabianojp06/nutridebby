ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_tipo_valido";--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "escopo" text DEFAULT 'equipe' NOT NULL;--> statement-breakpoint
CREATE INDEX "stored_files_paciente_idx" ON "stored_files" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patients_user_idx" ON "patients" USING btree ("user_id") WHERE "patients"."user_id" is not null;--> statement-breakpoint
-- NOT VALID: as linhas antigas (laudos, PDFs, exportações) ainda não têm patient_id; a 0072 preenche e valida
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_dono" CHECK (("stored_files"."tipo" in ('logo','capa','orientacao_pdf')) = ("stored_files"."patient_id" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao'));--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_escopo_valido" CHECK ("data_exports"."escopo" in ('equipe', 'titular'));