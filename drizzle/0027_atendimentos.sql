CREATE TABLE "consultation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"consultation_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_notes_consultation_id_unique" UNIQUE("consultation_id"),
	CONSTRAINT "consultation_notes_tamanho" CHECK (char_length("consultation_notes"."texto") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"data" date NOT NULL,
	"orientacoes_paciente" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultations_tenant_paciente_id_unique" UNIQUE("tenant_id","patient_id","id"),
	CONSTRAINT "consultations_orientacoes_tamanho" CHECK (char_length("consultations"."orientacoes_paciente") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "anthropometry" ADD COLUMN "consultation_id" uuid;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_atendimento_fk" FOREIGN KEY ("tenant_id","patient_id","consultation_id") REFERENCES "public"."consultations"("tenant_id","patient_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultations_paciente_data_idx" ON "consultations" USING btree ("tenant_id","patient_id","data");--> statement-breakpoint
ALTER TABLE "anthropometry" ADD CONSTRAINT "anthropometry_atendimento_fk" FOREIGN KEY ("tenant_id","patient_id","consultation_id") REFERENCES "public"."consultations"("tenant_id","patient_id","id") ON DELETE no action ON UPDATE no action;