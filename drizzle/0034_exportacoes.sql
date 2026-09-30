CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"arquivo_path" text,
	"expira_em" timestamp with time zone,
	"solicitado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_exports_status_valido" CHECK ("data_exports"."status" in ('pendente', 'pronta', 'falhou', 'expirada')),
	CONSTRAINT "data_exports_arquivo_do_tenant" CHECK ("data_exports"."arquivo_path" is null or "data_exports"."arquivo_path" like "data_exports"."tenant_id"::text || '/%')
);
--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_arquivo_path_stored_files_caminho_fk" FOREIGN KEY ("arquivo_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_solicitado_por_user_id_fk" FOREIGN KEY ("solicitado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_exports_paciente_idx" ON "data_exports" USING btree ("tenant_id","patient_id","created_at");