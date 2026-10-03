CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dia" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_events_dia_unique" UNIQUE("tenant_id","patient_id","dia")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tipo_valido";--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_paciente_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tipo_valido" CHECK ("notifications"."tipo" in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo'));