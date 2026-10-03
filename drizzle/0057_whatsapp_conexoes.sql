CREATE TABLE "whatsapp_conexoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instancia" text NOT NULL,
	"estado" text DEFAULT 'desconectada' NOT NULL,
	"numero_e164" text,
	"conectada_em" timestamp with time zone,
	"desconectada_em" timestamp with time zone,
	"aviso_desconexao_em" timestamp with time zone,
	"aviso_cota_mes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_conexoes_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "whatsapp_conexoes_instancia_unique" UNIQUE("instancia"),
	CONSTRAINT "whatsapp_conexoes_estado_valido" CHECK ("whatsapp_conexoes"."estado" in ('conectada', 'conectando', 'desconectada')),
	CONSTRAINT "whatsapp_conexoes_instancia_do_tenant" CHECK ("whatsapp_conexoes"."instancia" = 'nd-' || "whatsapp_conexoes"."tenant_id"::text),
	CONSTRAINT "whatsapp_conexoes_numero_e164" CHECK ("whatsapp_conexoes"."numero_e164" is null or "whatsapp_conexoes"."numero_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "whatsapp_conexoes" ADD CONSTRAINT "whatsapp_conexoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;