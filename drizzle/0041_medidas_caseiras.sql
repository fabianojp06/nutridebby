CREATE TABLE "food_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"plural" text NOT NULL,
	"gramas" numeric(7, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_measures_nome_unique" UNIQUE("tenant_id","food_id","nome"),
	CONSTRAINT "food_measures_gramas_faixa" CHECK ("food_measures"."gramas" between 0.1 and 5000),
	CONSTRAINT "food_measures_nome_tamanho" CHECK (char_length("food_measures"."nome") between 2 and 60 and char_length("food_measures"."plural") between 2 and 60)
);
--> statement-breakpoint
ALTER TABLE "food_measures" ADD CONSTRAINT "food_measures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_measures" ADD CONSTRAINT "food_measures_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_measures_alimento_idx" ON "food_measures" USING btree ("tenant_id","food_id");