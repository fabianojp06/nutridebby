CREATE TABLE "content_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"patient_id" uuid,
	"tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_audience_paciente_unique" UNIQUE("content_id","patient_id"),
	CONSTRAINT "content_audience_etiqueta_unique" UNIQUE("content_id","tag_id"),
	CONSTRAINT "content_audience_um_alvo" CHECK (("content_audience"."patient_id" is null) <> ("content_audience"."tag_id" is null))
);
--> statement-breakpoint
CREATE TABLE "content_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_favorites_unique" UNIQUE("content_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "content_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visto_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_views_unique" UNIQUE("content_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"titulo" text NOT NULL,
	"resumo" text DEFAULT '' NOT NULL,
	"corpo_md" text DEFAULT '' NOT NULL,
	"video_provider" text,
	"video_id" text,
	"capa_path" text,
	"pdf_path" text,
	"etiquetas" text[] DEFAULT '{}'::text[] NOT NULL,
	"visibilidade" text DEFAULT 'todos' NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"publicado_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contents_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contents_tipo_valido" CHECK ("contents"."tipo" in ('video', 'receita', 'orientacao')),
	CONSTRAINT "contents_visibilidade_valida" CHECK ("contents"."visibilidade" in ('todos', 'etiquetas', 'pacientes')),
	CONSTRAINT "contents_status_valido" CHECK ("contents"."status" in ('rascunho', 'publicado')),
	CONSTRAINT "contents_publicado_em" CHECK (("contents"."status" = 'publicado') = ("contents"."publicado_em" is not null)),
	CONSTRAINT "contents_textos_tamanho" CHECK (char_length("contents"."titulo") between 1 and 120 and char_length("contents"."resumo") <= 300 and char_length("contents"."corpo_md") <= 20000),
	CONSTRAINT "contents_etiquetas_tamanho" CHECK (cardinality("contents"."etiquetas") <= 10),
	CONSTRAINT "contents_video_completo" CHECK (("contents"."video_provider" is null) = ("contents"."video_id" is null) and ("contents"."tipo" <> 'video' or "contents"."video_id" is not null) and ("contents"."tipo" <> 'orientacao' or "contents"."video_id" is null)),
	CONSTRAINT "contents_video_id_valido" CHECK ("contents"."video_id" is null or ("contents"."video_provider" = 'youtube' and "contents"."video_id" ~ '^[A-Za-z0-9_-]{11}$') or ("contents"."video_provider" = 'vimeo' and "contents"."video_id" ~ '^[0-9]{6,12}(/[0-9a-f]{6,20})?$')),
	CONSTRAINT "contents_pdf_so_orientacao" CHECK ("contents"."pdf_path" is null or "contents"."tipo" = 'orientacao'),
	CONSTRAINT "contents_capa_do_tenant" CHECK ("contents"."capa_path" is null or "contents"."capa_path" like "contents"."tenant_id"::text || '/capa/%'),
	CONSTRAINT "contents_pdf_do_tenant" CHECK ("contents"."pdf_path" is null or "contents"."pdf_path" like "contents"."tenant_id"::text || '/orientacao_pdf/%')
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"quantidade_g" numeric(7, 2) NOT NULL,
	"medida_caseira_txt" text,
	"ordem" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_quantidade_faixa" CHECK ("recipe_ingredients"."quantidade_g" between 0.1 and 5000),
	CONSTRAINT "recipe_ingredients_medida_tamanho" CHECK ("recipe_ingredients"."medida_caseira_txt" is null or char_length("recipe_ingredients"."medida_caseira_txt") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rendimento_total_g" numeric(7, 1) NOT NULL,
	"porcao_g" numeric(7, 1) NOT NULL,
	"tempo_preparo_min" smallint,
	"modo_preparo_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_tenant_conteudo_unique" UNIQUE("tenant_id","content_id"),
	CONSTRAINT "recipes_rendimento_faixa" CHECK ("recipes"."rendimento_total_g" > 0 and "recipes"."rendimento_total_g" <= 20000),
	CONSTRAINT "recipes_porcao_valida" CHECK ("recipes"."porcao_g" > 0 and "recipes"."porcao_g" <= "recipes"."rendimento_total_g"),
	CONSTRAINT "recipes_tempo_faixa" CHECK ("recipes"."tempo_preparo_min" is null or "recipes"."tempo_preparo_min" between 1 and 1440),
	CONSTRAINT "recipes_modo_tamanho" CHECK (char_length("recipes"."modo_preparo_md") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "recipe_content_id" uuid;--> statement-breakpoint
ALTER TABLE "content_audience" ADD CONSTRAINT "content_audience_conteudo_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."contents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_audience" ADD CONSTRAINT "content_audience_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_audience" ADD CONSTRAINT "content_audience_etiqueta_fk" FOREIGN KEY ("tenant_id","tag_id") REFERENCES "public"."patient_tags"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_favorites" ADD CONSTRAINT "content_favorites_conteudo_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."contents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_favorites" ADD CONSTRAINT "content_favorites_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_conteudo_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."contents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_capa_path_stored_files_caminho_fk" FOREIGN KEY ("capa_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_pdf_path_stored_files_caminho_fk" FOREIGN KEY ("pdf_path") REFERENCES "public"."stored_files"("caminho") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_receita_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."recipes"("tenant_id","content_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_conteudo_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."contents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_audience_paciente_idx" ON "content_audience" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "content_audience_etiqueta_idx" ON "content_audience" USING btree ("tenant_id","tag_id");--> statement-breakpoint
CREATE INDEX "content_favorites_paciente_idx" ON "content_favorites" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "content_views_paciente_idx" ON "content_views" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "contents_feed_idx" ON "contents" USING btree ("tenant_id","status","publicado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contents_etiquetas_idx" ON "contents" USING gin ("etiquetas");--> statement-breakpoint
CREATE INDEX "contents_busca_idx" ON "contents" USING gin (to_tsvector('portuguese', app_unaccent("titulo" || ' ' || "resumo")));--> statement-breakpoint
CREATE INDEX "recipe_ingredients_receita_idx" ON "recipe_ingredients" USING btree ("tenant_id","content_id","ordem");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_alimento_idx" ON "recipe_ingredients" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "meals_receita_idx" ON "meals" USING btree ("tenant_id","recipe_content_id") WHERE "meals"."recipe_content_id" is not null;