CREATE TABLE "anthropometry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data" date NOT NULL,
	"peso_kg" numeric(5, 2) NOT NULL,
	"altura_cm" numeric(5, 1) NOT NULL,
	"imc" numeric(6, 2) GENERATED ALWAYS AS (round(peso_kg / ((altura_cm / 100) * (altura_cm / 100)), 2)) STORED,
	"circunferencias" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dobras_mm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"protocolo" text DEFAULT 'nenhum' NOT NULL,
	"densidade" numeric(6, 5),
	"perc_gordura" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anthropometry_peso_faixa" CHECK ("anthropometry"."peso_kg" between 1 and 400),
	CONSTRAINT "anthropometry_altura_faixa" CHECK ("anthropometry"."altura_cm" between 30 and 250),
	CONSTRAINT "anthropometry_protocolo_valido" CHECK ("anthropometry"."protocolo" in ('jp3', 'jp7', 'nenhum'))
);
--> statement-breakpoint
ALTER TABLE "anthropometry" ADD CONSTRAINT "anthropometry_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anthropometry_paciente_data_idx" ON "anthropometry" USING btree ("tenant_id","patient_id","data");