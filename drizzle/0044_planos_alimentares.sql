CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"plan_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"quantidade_g" numeric(7, 2) NOT NULL,
	"medida" jsonb,
	"medida_caseira_txt" text,
	"substitui_item_id" uuid,
	"ordem" smallint NOT NULL,
	"nutrientes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_tenant_refeicao_id_unique" UNIQUE("tenant_id","meal_id","id"),
	CONSTRAINT "meal_items_quantidade_faixa" CHECK ("meal_items"."quantidade_g" between 0.1 and 5000),
	CONSTRAINT "meal_items_nao_substitui_a_si" CHECK ("meal_items"."substitui_item_id" is null or "meal_items"."substitui_item_id" <> "meal_items"."id")
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"titulo" text NOT NULL,
	"meta_kcal" integer,
	"energy_calc_id" uuid,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"revisao" integer DEFAULT 0 NOT NULL,
	"publicado_em" timestamp with time zone,
	"origem_plan_id" uuid,
	"mostrar_calorias" boolean DEFAULT false NOT NULL,
	"orientacoes" text DEFAULT '' NOT NULL,
	"pdf_path" text,
	"pdf_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plans_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "meal_plans_tenant_id_paciente_unique" UNIQUE("tenant_id","id","patient_id"),
	CONSTRAINT "meal_plans_status_valido" CHECK ("meal_plans"."status" in ('rascunho', 'publicado', 'arquivado')),
	CONSTRAINT "meal_plans_modelo_sem_paciente" CHECK ("meal_plans"."is_template" = ("meal_plans"."patient_id" is null)),
	CONSTRAINT "meal_plans_modelo_rascunho" CHECK (not "meal_plans"."is_template" or "meal_plans"."status" = 'rascunho'),
	CONSTRAINT "meal_plans_versao_valida" CHECK ("meal_plans"."versao" >= 1),
	CONSTRAINT "meal_plans_meta_faixa" CHECK ("meal_plans"."meta_kcal" is null or "meal_plans"."meta_kcal" between 500 and 10000),
	CONSTRAINT "meal_plans_pdf_status_valido" CHECK ("meal_plans"."pdf_status" is null or "meal_plans"."pdf_status" in ('pendente', 'pronto', 'falhou')),
	CONSTRAINT "meal_plans_pdf_do_tenant" CHECK ("meal_plans"."pdf_path" is null or "meal_plans"."pdf_path" like "meal_plans"."tenant_id"::text || '/plano_pdf/%'),
	CONSTRAINT "meal_plans_textos_tamanho" CHECK (char_length("meal_plans"."titulo") between 1 and 120 and char_length("meal_plans"."orientacoes") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"plan_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"horario" time,
	"ordem" smallint NOT NULL,
	"observacao" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meals_tenant_plano_id_unique" UNIQUE("tenant_id","plan_id","id"),
	CONSTRAINT "meals_textos_tamanho" CHECK (char_length("meals"."nome") between 1 and 60 and char_length("meals"."observacao") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_refeicao_fk" FOREIGN KEY ("tenant_id","plan_id","meal_id") REFERENCES "public"."meals"("tenant_id","plan_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_plano_paciente_fk" FOREIGN KEY ("tenant_id","plan_id","patient_id") REFERENCES "public"."meal_plans"("tenant_id","id","patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_principal_fk" FOREIGN KEY ("tenant_id","meal_id","substitui_item_id") REFERENCES "public"."meal_items"("tenant_id","meal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_pdf_path_stored_files_caminho_fk" FOREIGN KEY ("pdf_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_plano_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."meal_plans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_plano_paciente_fk" FOREIGN KEY ("tenant_id","plan_id","patient_id") REFERENCES "public"."meal_plans"("tenant_id","id","patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_items_refeicao_idx" ON "meal_items" USING btree ("tenant_id","meal_id","ordem");--> statement-breakpoint
CREATE INDEX "meal_items_alimento_idx" ON "meal_items" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_um_publicado_idx" ON "meal_plans" USING btree ("tenant_id","patient_id") WHERE "meal_plans"."status" = 'publicado';--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_um_rascunho_idx" ON "meal_plans" USING btree ("tenant_id","patient_id") WHERE "meal_plans"."status" = 'rascunho' and "meal_plans"."patient_id" is not null;--> statement-breakpoint
CREATE INDEX "meal_plans_paciente_idx" ON "meal_plans" USING btree ("tenant_id","patient_id","versao");--> statement-breakpoint
CREATE INDEX "meals_plano_idx" ON "meals" USING btree ("tenant_id","plan_id","ordem");