CREATE TABLE "energy_calcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"formula" text NOT NULL,
	"peso_kg" numeric(5, 2) NOT NULL,
	"altura_cm" numeric(5, 1) NOT NULL,
	"idade" integer NOT NULL,
	"sexo" text NOT NULL,
	"fator_atividade" numeric(3, 2) NOT NULL,
	"tmb" numeric(12, 6) NOT NULL,
	"get" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "energy_calcs_formula_valida" CHECK ("energy_calcs"."formula" in ('harris_benedict', 'mifflin', 'fao_oms')),
	CONSTRAINT "energy_calcs_fator_faixa" CHECK ("energy_calcs"."fator_atividade" between 1.00 and 2.50),
	CONSTRAINT "energy_calcs_sexo_valido" CHECK ("energy_calcs"."sexo" in ('F', 'M')),
	CONSTRAINT "energy_calcs_idade_adulto" CHECK ("energy_calcs"."idade" >= 18)
);
--> statement-breakpoint
ALTER TABLE "energy_calcs" ADD CONSTRAINT "energy_calcs_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "energy_calcs_paciente_idx" ON "energy_calcs" USING btree ("tenant_id","patient_id","created_at");