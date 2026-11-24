CREATE TABLE "prescricao_itens_salvos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"item" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescricao_itens_salvos_nome_tamanho" CHECK (char_length("prescricao_itens_salvos"."nome") between 1 and 80),
	CONSTRAINT "prescricao_itens_salvos_tipo_valido" CHECK ("prescricao_itens_salvos"."tipo" in ('suplemento', 'planta_cha', 'derivado_vegetal', 'fitoterapico', 'formula_fitoterapica')),
	CONSTRAINT "prescricao_itens_salvos_item_objeto" CHECK (jsonb_typeof("prescricao_itens_salvos"."item") = 'object'),
	CONSTRAINT "prescricao_itens_salvos_tipo_coerente" CHECK (("prescricao_itens_salvos"."item"->>'tipo') is not distinct from "prescricao_itens_salvos"."tipo")
);
--> statement-breakpoint
CREATE TABLE "prescricao_modelos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"itens" jsonb NOT NULL,
	"orientacoes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescricao_modelos_nome_tamanho" CHECK (char_length("prescricao_modelos"."nome") between 1 and 80),
	CONSTRAINT "prescricao_modelos_itens" CHECK (case when jsonb_typeof("prescricao_modelos"."itens") = 'array' then jsonb_array_length("prescricao_modelos"."itens") between 1 and 20 else false end),
	CONSTRAINT "prescricao_modelos_orientacoes_tamanho" CHECK (char_length("prescricao_modelos"."orientacoes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "prescricao_itens_salvos" ADD CONSTRAINT "prescricao_itens_salvos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescricao_modelos" ADD CONSTRAINT "prescricao_modelos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prescricao_itens_salvos_nome_unico" ON "prescricao_itens_salvos" USING btree ("tenant_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "prescricao_modelos_nome_unico" ON "prescricao_modelos" USING btree ("tenant_id",lower("nome"));