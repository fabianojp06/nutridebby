CREATE TABLE "patient_tag_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_tag_links_unique" UNIQUE("patient_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "patient_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" "citext" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_tags_tenant_nome_unique" UNIQUE("tenant_id","nome"),
	CONSTRAINT "patient_tags_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "patient_tags_nome_tamanho" CHECK (char_length("patient_tags"."nome") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "patient_tag_links" ADD CONSTRAINT "patient_tag_links_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tag_links" ADD CONSTRAINT "patient_tag_links_etiqueta_fk" FOREIGN KEY ("tenant_id","tag_id") REFERENCES "public"."patient_tags"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_tag_links_etiqueta_idx" ON "patient_tag_links" USING btree ("tenant_id","tag_id");