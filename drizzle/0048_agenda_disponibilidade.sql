CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_blocks_fim_depois" CHECK ("availability_blocks"."fim" > "availability_blocks"."inicio"),
	CONSTRAINT "availability_blocks_motivo_tamanho" CHECK (char_length("availability_blocks"."motivo") <= 120)
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dia_semana" smallint NOT NULL,
	"inicio" time NOT NULL,
	"fim" time NOT NULL,
	"duracao_min" smallint NOT NULL,
	"modalidade" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_dia_valido" CHECK ("availability_rules"."dia_semana" between 0 and 6),
	CONSTRAINT "availability_rules_fim_depois" CHECK ("availability_rules"."fim" > "availability_rules"."inicio"),
	CONSTRAINT "availability_rules_duracao_faixa" CHECK ("availability_rules"."duracao_min" between 15 and 240),
	CONSTRAINT "availability_rules_modalidade_valida" CHECK ("availability_rules"."modalidade" in ('presencial', 'online', 'ambas'))
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_periodo_idx" ON "availability_blocks" USING btree ("tenant_id","inicio");--> statement-breakpoint
CREATE INDEX "availability_rules_dia_idx" ON "availability_rules" USING btree ("tenant_id","dia_semana");