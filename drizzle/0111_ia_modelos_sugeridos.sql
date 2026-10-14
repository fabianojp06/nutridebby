CREATE TABLE "ia_geracoes_modelos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"area" text NOT NULL,
	"status" text DEFAULT 'na_fila' NOT NULL,
	"pedido_por" uuid NOT NULL,
	"modelo" text NOT NULL,
	"prompt_versao" text NOT NULL,
	"reserva_micro_usd" bigint NOT NULL,
	"custo_micro_usd" bigint,
	"erro" text,
	"itens_descartados" integer DEFAULT 0 NOT NULL,
	"voltas" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciado_em" timestamp with time zone,
	"enviado_em" timestamp with time zone,
	"concluido_em" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ia_geracoes_modelos_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ia_geracoes_modelos_area_valida" CHECK ("ia_geracoes_modelos"."area" in ('emagrecimento', 'esportiva', 'gestacao', 'diabetes', 'hipertensao', 'vegetariana', 'idosos')),
	CONSTRAINT "ia_geracoes_modelos_status_valido" CHECK ("ia_geracoes_modelos"."status" in ('na_fila', 'processando', 'pronta', 'falhou', 'cancelada')),
	CONSTRAINT "ia_geracoes_modelos_erro_so_falhou" CHECK (("ia_geracoes_modelos"."status" = 'falhou') = ("ia_geracoes_modelos"."erro" is not null)),
	CONSTRAINT "ia_geracoes_modelos_erro_tamanho" CHECK ("ia_geracoes_modelos"."erro" is null or char_length("ia_geracoes_modelos"."erro") <= 60),
	CONSTRAINT "ia_geracoes_modelos_descartados_valido" CHECK ("ia_geracoes_modelos"."itens_descartados" >= 0 and "ia_geracoes_modelos"."voltas" >= 0 and "ia_geracoes_modelos"."reserva_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "ia_geracao_id" uuid;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "aprovado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD COLUMN "aprovado_por" uuid;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "ia_geracao_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "aprovado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "aprovado_por" uuid;--> statement-breakpoint
ALTER TABLE "ia_geracoes_modelos" ADD CONSTRAINT "ia_geracoes_modelos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ia_geracoes_modelos_em_andamento_idx" ON "ia_geracoes_modelos" USING btree ("tenant_id") WHERE "ia_geracoes_modelos"."status" in ('na_fila', 'processando');--> statement-breakpoint
CREATE INDEX "ia_geracoes_modelos_area_idx" ON "ia_geracoes_modelos" USING btree ("tenant_id","area","criado_em");--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_ia_geracao_fk" FOREIGN KEY ("tenant_id","ia_geracao_id") REFERENCES "public"."ia_geracoes_modelos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_aprovacao_coerente" CHECK (("anamnesis_templates"."aprovado_em" is null) = ("anamnesis_templates"."aprovado_por" is null) and ("anamnesis_templates"."aprovado_em" is null or "anamnesis_templates"."ia_geracao_id" is not null));--> statement-breakpoint
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_padrao_aprovado" CHECK (not "anamnesis_templates"."padrao" or "anamnesis_templates"."ia_geracao_id" is null or "anamnesis_templates"."aprovado_em" is not null);--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_ia_geracao_so_modelo" CHECK ("meal_plans"."ia_geracao_id" is null or "meal_plans"."is_template");--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_aprovacao_coerente" CHECK (("meal_plans"."aprovado_em" is null) = ("meal_plans"."aprovado_por" is null) and ("meal_plans"."aprovado_em" is null or "meal_plans"."ia_geracao_id" is not null));