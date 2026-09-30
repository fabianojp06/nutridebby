CREATE TABLE "anamneses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"template_id" uuid,
	"template_snapshot" jsonb NOT NULL,
	"respostas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anamnesis_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"schema" jsonb NOT NULL,
	"padrao" boolean DEFAULT false NOT NULL,
	"arquivado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anamnesis_templates_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "anamnesis_templates_nome_tamanho" CHECK (char_length("anamnesis_templates"."nome") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamneses" ADD CONSTRAINT "anamneses_modelo_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."anamnesis_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anamneses_paciente_idx" ON "anamneses" USING btree ("tenant_id","patient_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "anamnesis_templates_padrao_idx" ON "anamnesis_templates" USING btree ("tenant_id") WHERE "anamnesis_templates"."padrao";