CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_tipo_valido" CHECK ("invites"."tipo" in ('nutri'))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "crn" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cor_primaria" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wa_cota_mensal" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "antecedencia_min_h" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cancelamento_min_h" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "endereco_consultorio" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "link_online_padrao" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agendamento_publico_ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mostrar_perc_gordura_paciente" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "armazenamento_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "dpa_aceito_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "dpa_versao" text;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_user_idx" ON "invites" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cor_formato" CHECK ("tenants"."cor_primaria" is null or "tenants"."cor_primaria" ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_antecedencia_faixa" CHECK ("tenants"."antecedencia_min_h" between 0 and 72);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cancelamento_faixa" CHECK ("tenants"."cancelamento_min_h" between 0 and 72);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_wa_cota_valida" CHECK ("tenants"."wa_cota_mensal" >= 0);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_armazenamento_valido" CHECK ("tenants"."armazenamento_bytes" >= 0);