CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"prazo" date NOT NULL,
	"concluido_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_tipo_valido" CHECK ("privacy_requests"."tipo" in ('exportacao', 'exclusao')),
	CONSTRAINT "privacy_requests_status_valido" CHECK ("privacy_requests"."status" in ('aberto', 'concluido'))
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_paciente_idx" ON "privacy_requests" USING btree ("tenant_id","patient_id","status");