CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"taco_id" smallint,
	"nome" text NOT NULL,
	"grupo" text NOT NULL,
	"kcal" numeric(7, 2),
	"proteina_g" numeric(7, 2),
	"carboidrato_g" numeric(7, 2),
	"lipidio_g" numeric(7, 2),
	"fibra_g" numeric(7, 2),
	"micros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"medidas_caseiras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origem_food_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_taco_id_unique" UNIQUE("taco_id"),
	CONSTRAINT "foods_origem_valida" CHECK (("foods"."tenant_id" is null) = ("foods"."taco_id" is not null)),
	CONSTRAINT "foods_proprio_completo" CHECK ("foods"."tenant_id" is null or ("foods"."kcal" is not null and "foods"."proteina_g" is not null and "foods"."carboidrato_g" is not null and "foods"."lipidio_g" is not null and "foods"."fibra_g" is not null)),
	CONSTRAINT "foods_valores_faixa" CHECK (coalesce("foods"."kcal", 0) between 0 and 900 and coalesce("foods"."proteina_g", 0) between 0 and 100 and coalesce("foods"."carboidrato_g", 0) between 0 and 100 and coalesce("foods"."lipidio_g", 0) between 0 and 100 and coalesce("foods"."fibra_g", 0) between 0 and 100),
	CONSTRAINT "foods_grupo_valido" CHECK ("foods"."grupo" in ('Cereais e derivados', 'Verduras, hortaliças e derivados', 'Frutas e derivados', 'Gorduras e óleos', 'Pescados e frutos do mar', 'Carnes e derivados', 'Leite e derivados', 'Bebidas (alcoólicas e não alcoólicas)', 'Ovos e derivados', 'Produtos açucarados', 'Miscelâneas', 'Outros alimentos industrializados', 'Alimentos preparados', 'Leguminosas e derivados', 'Nozes e sementes')),
	CONSTRAINT "foods_nome_tamanho" CHECK (char_length("foods"."nome") between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "foods_tenant_idx" ON "foods" USING btree ("tenant_id");