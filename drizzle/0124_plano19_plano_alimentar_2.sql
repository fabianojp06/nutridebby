CREATE TABLE "listas_substituicao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"orientacao" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listas_substituicao_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "listas_substituicao_nome_unique" UNIQUE("tenant_id","nome"),
	CONSTRAINT "listas_substituicao_textos_tamanho" CHECK (char_length("listas_substituicao"."nome") between 1 and 80 and char_length("listas_substituicao"."orientacao") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "listas_substituicao_grupos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lista_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listas_substituicao_grupos_tenant_lista_id_unique" UNIQUE("tenant_id","lista_id","id"),
	CONSTRAINT "listas_substituicao_grupos_nome_tamanho" CHECK (char_length("listas_substituicao_grupos"."nome") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "listas_substituicao_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lista_id" uuid NOT NULL,
	"grupo_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"quantidade_g" numeric(7, 2) NOT NULL,
	"medida" jsonb,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listas_substituicao_itens_quantidade_faixa" CHECK ("listas_substituicao_itens"."quantidade_g" between 0.1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "refeicoes_modelo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"horario" time,
	"modo" text DEFAULT 'calculado' NOT NULL,
	"descricao_livre" text,
	"observacao" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refeicoes_modelo_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "refeicoes_modelo_tipo_valido" CHECK ("refeicoes_modelo"."tipo" in ('Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outra')),
	CONSTRAINT "refeicoes_modelo_modo_valido" CHECK ("refeicoes_modelo"."modo" in ('calculado', 'livre')),
	CONSTRAINT "refeicoes_modelo_textos_tamanho" CHECK (char_length("refeicoes_modelo"."nome") between 1 and 60 and char_length("refeicoes_modelo"."observacao") <= 2000 and ("refeicoes_modelo"."descricao_livre" is null or char_length("refeicoes_modelo"."descricao_livre") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "refeicoes_modelo_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"refeicao_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"quantidade_g" numeric(7, 2) NOT NULL,
	"medida" jsonb,
	"substitui_item_id" uuid,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refeicoes_modelo_itens_tenant_refeicao_id_unique" UNIQUE("tenant_id","refeicao_id","id"),
	CONSTRAINT "refeicoes_modelo_itens_quantidade_faixa" CHECK ("refeicoes_modelo_itens"."quantidade_g" between 0.1 and 5000),
	CONSTRAINT "refeicoes_modelo_itens_nao_substitui_a_si" CHECK ("refeicoes_modelo_itens"."substitui_item_id" is null or "refeicoes_modelo_itens"."substitui_item_id" <> "refeicoes_modelo_itens"."id")
);
--> statement-breakpoint
CREATE TABLE "referencias_nutrientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"fonte" text NOT NULL,
	"valores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referencias_nutrientes_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "referencias_nutrientes_nome_unique" UNIQUE("tenant_id","nome"),
	CONSTRAINT "referencias_nutrientes_textos_tamanho" CHECK (char_length("referencias_nutrientes"."nome") between 1 and 80 and char_length("referencias_nutrientes"."fonte") between 2 and 300),
	CONSTRAINT "referencias_nutrientes_valores_objeto" CHECK (jsonb_typeof("referencias_nutrientes"."valores") = 'object')
);
--> statement-breakpoint
CREATE TABLE "plano_conteudos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"plan_id" uuid NOT NULL,
	"content_id" uuid,
	"titulo" text NOT NULL,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plano_conteudos_unique" UNIQUE("plan_id","content_id"),
	CONSTRAINT "plano_conteudos_titulo_tamanho" CHECK (char_length("plano_conteudos"."titulo") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "plano_listas_substituicao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid,
	"plan_id" uuid NOT NULL,
	"lista_origem_id" uuid,
	"nome" text NOT NULL,
	"orientacao" text DEFAULT '' NOT NULL,
	"conteudo" jsonb NOT NULL,
	"copiada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plano_listas_substituicao_textos_tamanho" CHECK (char_length("plano_listas_substituicao"."nome") between 1 and 80 and char_length("plano_listas_substituicao"."orientacao") <= 1000),
	CONSTRAINT "plano_listas_substituicao_conteudo_valido" CHECK (jsonb_typeof("plano_listas_substituicao"."conteudo") = 'object' and octet_length("plano_listas_substituicao"."conteudo"::text) <= 524288)
);
--> statement-breakpoint
ALTER TABLE "foods" DROP CONSTRAINT "foods_origem_valida";--> statement-breakpoint
ALTER TABLE "foods" DROP CONSTRAINT "foods_valores_faixa";--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "fonte" text DEFAULT 'propria' NOT NULL;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "fonte_ref" text;--> statement-breakpoint
ALTER TABLE "foods" ADD COLUMN "nome_original" text;--> statement-breakpoint
-- Plano 19 (editado à mão): preenche fonte/fonte_ref das linhas públicas atuais (a TACO) ANTES do CHECK novo
-- foods_origem_valida, mais abaixo; as próprias ficam "propria" pelo default permanente (spec §4.1, §9.1, I-2). foods tem
-- FORCE RLS desde a 0040 e o migrator de produção é NOBYPASSRLS: sem o NO FORCE, o UPDATE não vê linha nenhuma
-- (taco_leitura é só SELECT) e o CHECK recusaria a TACO. Molde da 0042; nunca uma política de escrita com tenant_id nulo.
-- Ao regenerar esta migration sobre a main (sessoes-paralelas.md §5, passo 1), reaplicar este bloco entre o ADD COLUMN de
-- foods e os ADD CONSTRAINT dos CHECKs de foods. Conferido por src/db/migrate-owner.test.ts (migrator sem superusuário).
ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "foods" SET "fonte" = 'taco', "fonte_ref" = "taco_id"::text WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "modo" text DEFAULT 'calculado' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "referencia_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "nutrientes_exibidos" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "referencia_congelada" jsonb;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "macros_prescritos" jsonb;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD COLUMN "mostrar_micros_pdf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "dias_semana" smallint[] DEFAULT '{0,1,2,3,4,5,6}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "descricao_livre" text;--> statement-breakpoint
ALTER TABLE "listas_substituicao" ADD CONSTRAINT "listas_substituicao_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listas_substituicao_grupos" ADD CONSTRAINT "listas_substituicao_grupos_lista_fk" FOREIGN KEY ("tenant_id","lista_id") REFERENCES "public"."listas_substituicao"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listas_substituicao_itens" ADD CONSTRAINT "listas_substituicao_itens_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listas_substituicao_itens" ADD CONSTRAINT "listas_substituicao_itens_grupo_fk" FOREIGN KEY ("tenant_id","lista_id","grupo_id") REFERENCES "public"."listas_substituicao_grupos"("tenant_id","lista_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refeicoes_modelo" ADD CONSTRAINT "refeicoes_modelo_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refeicoes_modelo_itens" ADD CONSTRAINT "refeicoes_modelo_itens_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refeicoes_modelo_itens" ADD CONSTRAINT "refeicoes_modelo_itens_refeicao_fk" FOREIGN KEY ("tenant_id","refeicao_id") REFERENCES "public"."refeicoes_modelo"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refeicoes_modelo_itens" ADD CONSTRAINT "refeicoes_modelo_itens_principal_fk" FOREIGN KEY ("tenant_id","refeicao_id","substitui_item_id") REFERENCES "public"."refeicoes_modelo_itens"("tenant_id","refeicao_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referencias_nutrientes" ADD CONSTRAINT "referencias_nutrientes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_conteudos" ADD CONSTRAINT "plano_conteudos_plano_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."meal_plans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_conteudos" ADD CONSTRAINT "plano_conteudos_plano_paciente_fk" FOREIGN KEY ("tenant_id","plan_id","patient_id") REFERENCES "public"."meal_plans"("tenant_id","id","patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_listas_substituicao" ADD CONSTRAINT "plano_listas_substituicao_plano_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."meal_plans"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_listas_substituicao" ADD CONSTRAINT "plano_listas_substituicao_plano_paciente_fk" FOREIGN KEY ("tenant_id","plan_id","patient_id") REFERENCES "public"."meal_plans"("tenant_id","id","patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listas_substituicao_grupos_lista_idx" ON "listas_substituicao_grupos" USING btree ("tenant_id","lista_id","ordem");--> statement-breakpoint
CREATE INDEX "listas_substituicao_itens_grupo_idx" ON "listas_substituicao_itens" USING btree ("tenant_id","grupo_id","ordem");--> statement-breakpoint
CREATE INDEX "listas_substituicao_itens_alimento_idx" ON "listas_substituicao_itens" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "refeicoes_modelo_tenant_idx" ON "refeicoes_modelo" USING btree ("tenant_id","tipo");--> statement-breakpoint
CREATE INDEX "refeicoes_modelo_itens_refeicao_idx" ON "refeicoes_modelo_itens" USING btree ("tenant_id","refeicao_id","ordem");--> statement-breakpoint
CREATE INDEX "refeicoes_modelo_itens_alimento_idx" ON "refeicoes_modelo_itens" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "plano_conteudos_plano_idx" ON "plano_conteudos" USING btree ("tenant_id","plan_id","ordem");--> statement-breakpoint
CREATE INDEX "plano_conteudos_conteudo_idx" ON "plano_conteudos" USING btree ("tenant_id","content_id") WHERE "plano_conteudos"."content_id" is not null;--> statement-breakpoint
CREATE INDEX "plano_listas_substituicao_plano_idx" ON "plano_listas_substituicao" USING btree ("tenant_id","plan_id","ordem");--> statement-breakpoint
CREATE INDEX "foods_grupo_idx" ON "foods" USING btree ("grupo");--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_fonte_ref_unique" UNIQUE("fonte","fonte_ref");--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_fonte_valida" CHECK ("foods"."fonte" in ('taco', 'usda', 'tbca', 'propria'));--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_fonte_ref_tamanho" CHECK ("foods"."fonte_ref" is null or char_length("foods"."fonte_ref") between 1 and 40);--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_nome_original_valido" CHECK ("foods"."nome_original" is null or ("foods"."fonte" = 'usda' and char_length("foods"."nome_original") between 2 and 200));--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_origem_valida" CHECK (("foods"."tenant_id" is null) = ("foods"."fonte" <> 'propria') and ("foods"."fonte" = 'propria') = ("foods"."fonte_ref" is null) and ("foods"."taco_id" is not null) = ("foods"."fonte" = 'taco'));--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_valores_faixa" CHECK (coalesce("foods"."kcal", 0) between 0 and 1000 and coalesce("foods"."proteina_g", 0) between 0 and 100 and coalesce("foods"."carboidrato_g", 0) between 0 and 100 and coalesce("foods"."lipidio_g", 0) between 0 and 100 and coalesce("foods"."fibra_g", 0) between 0 and 100);--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_modo_valido" CHECK ("meal_plans"."modo" in ('calculado', 'livre'));--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_nutrientes_exibidos_limite" CHECK (cardinality("meal_plans"."nutrientes_exibidos") <= 12);--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_referencia_so_rascunho" CHECK ("meal_plans"."referencia_id" is null or "meal_plans"."status" = 'rascunho');--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_referencia_congelada_publicada" CHECK ("meal_plans"."referencia_congelada" is null or "meal_plans"."status" <> 'rascunho');--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_macros_so_livre" CHECK ("meal_plans"."macros_prescritos" is null or "meal_plans"."modo" = 'livre');--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_descricao_livre_tamanho" CHECK ("meals"."descricao_livre" is null or char_length("meals"."descricao_livre") <= 2000);