CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"caminho" text NOT NULL,
	"bytes" bigint NOT NULL,
	"mime" text NOT NULL,
	"criado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_caminho_unique" UNIQUE("caminho"),
	CONSTRAINT "stored_files_tipo_valido" CHECK ("stored_files"."tipo" in ('logo','capa','exame','plano_pdf','diario_foto','orientacao_pdf','exportacao')),
	CONSTRAINT "stored_files_bytes_positivo" CHECK ("stored_files"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_tenant_idx" ON "stored_files" USING btree ("tenant_id","tipo");