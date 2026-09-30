CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_acao_valida" CHECK ("audit_log"."acao" in ('ler','criar','alterar','excluir','exportar','bloquear','anonimizar'))
);
--> statement-breakpoint
CREATE TABLE "system_heartbeat" (
	"name" text PRIMARY KEY NOT NULL,
	"beat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome_exibicao" text NOT NULL,
	"status" text DEFAULT 'ativa' NOT NULL,
	"fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_slug_formato" CHECK ("tenants"."slug" ~ '^[a-z0-9-]{3,40}$'),
	CONSTRAINT "tenants_status_valido" CHECK ("tenants"."status" in ('ativa', 'suspensa'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_busca_idx" ON "audit_log" USING btree ("tenant_id","entidade","entidade_id","criado_em");